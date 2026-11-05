"""Read-only OS/Engine discovery. Never executes repair, credential or model actions."""
import argparse,json,os,subprocess,time
from pathlib import Path
from .model import component_id,public_component,metrics

def run(args,timeout=15):return subprocess.check_output(args,text=True,timeout=timeout,stderr=subprocess.DEVNULL)
def atomic(path,value):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix('.next');t.write_text(value);t.chmod(0o644);os.replace(t,p)
def retired_unit_observation(name,now):
    """Confirm a retired unit's state; failed discovery is never absence proof."""
    try:
        result=subprocess.run(['systemctl','show','--property=LoadState,ActiveState,SubState,MainPID','--no-pager','--',name],capture_output=True,text=True,timeout=5)
        state=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        missing=all(state.get(k)==v for k,v in {'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0'}.items())
        loaded=result.returncode==0 and state.get('LoadState')=='loaded' and state.get('ActiveState') and state.get('SubState')
        if loaded or (result.returncode in (0,4) and missing):
            return {'observed_at':now,'state':state['ActiveState'],'substate':state['SubState'],'load_state':state['LoadState'],'source':'systemctl-show-retired'}
    except (OSError,subprocess.SubprocessError,ValueError):pass
    return None

def collect(registry,host):
    now=time.time();observations={};discovered=[];errors=[]
    try:
        units=json.loads(run(['systemctl','list-units','--all','--type=service','--output=json','--no-pager']))
        for unit in units:
            name=unit['unit']
            try:ident=component_id(host,'unit',name)
            except ValueError:errors.append('unsupported_unit_name');continue
            observations[ident]={'observed_at':now,'state':unit['active'],'substate':unit['sub']}
            if unit['sub']=='running':discovered.append(('unit',name))
    except Exception:errors.append('systemd_unavailable')
    try:
        ids=run(['docker','ps','-aq']).split()
        result=subprocess.run(['docker','inspect',*ids],capture_output=True,text=True,timeout=15) if ids else None
        containers=json.loads(result.stdout) if result and result.stdout.strip() else []
        if result and result.returncode:errors.append('docker_partial_inventory')
        for c in containers:
            name=c['Name'].lstrip('/');ident=component_id(host,'container',name);state=c['State']
            observations[ident]={'observed_at':now,'state':state['Status'],'health':state.get('Health',{}).get('Status','not_configured'),'restart_count':c['RestartCount'],'oom_killed':state.get('OOMKilled',False),'exit_code':state.get('ExitCode')}
            discovered.append(('container',name))
    except Exception:errors.append('docker_unavailable')
    specs={x['id']:x for x in registry['components'] if x['host']==host and x['kind'] in ('unit','container')}
    # systemd unloads inactive units once nothing references them. For an
    # explicitly retired registration, obtain its real state rather than
    # interpreting absence from list-units as a monitoring failure.
    for ident,spec in specs.items():
        if spec['kind']=='unit' and spec.get('retired') and ident not in observations and 'systemd_unavailable' not in errors:
            observation=retired_unit_observation(spec['name'],now)
            if observation is not None:observations[ident]=observation
    for kind,name in discovered:
        ident=component_id(host,kind,name)
        if ident not in specs:specs[ident]={'id':ident,'host':host,'kind':kind,'name':name,'expected':'running','classified':False,'owner':'technical-inbox','depends_on':[]}
    return {'schema':1,'host':host,'collected_at':now,'source_errors':errors,'components':[public_component(s,observations.get(i),now) for i,s in specs.items()]}
def main():
    p=argparse.ArgumentParser();p.add_argument('--registry',required=True);p.add_argument('--host',required=True);p.add_argument('--output',required=True);p.add_argument('--prom',required=True);a=p.parse_args()
    value=collect(json.loads(Path(a.registry).read_text()),a.host)
    atomic(a.output,json.dumps(value));atomic(a.prom,metrics(value))
if __name__=='__main__':main()
