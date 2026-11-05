"""Versioned service registry and normalized, freshness-aware observation contract."""
import hashlib,json,re,time

PATTERN=re.compile(r'^(?:[a-zA-Z0-9_.:@-]|\\x[0-9a-fA-F]{2}){1,255}$')
def component_id(host,kind,name):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', host) or kind not in ('unit','container','probe','postgres','redis','rabbitmq','job','monitor'):raise ValueError('Unknown component scope')
    if not PATTERN.fullmatch(name):raise ValueError('Invalid component name')
    return hashlib.sha256((host+'\0'+kind+'\0'+name).encode()).hexdigest()[:24]
def assess(spec,observation,now=None):
    now=time.time() if now is None else now
    if not observation or now-observation.get('observed_at',0)>spec.get('max_age',180):return 'unknown'
    if spec.get('retired') and observation.get('state') in ('running','active','up'):return 'unhealthy'
    if spec.get('expected') in ('maintenance','inactive','exited','paused'):
        return 'maintenance' if observation.get('state') in ('inactive','exited','paused','dead') else 'healthy'
    if observation.get('error'):return 'unknown'
    state=observation.get('state')
    if spec['kind']=='job':return observation.get('health','unknown')
    if state not in ('running','active','up'):return 'unhealthy'
    return 'unhealthy' if observation.get('health')=='unhealthy' else 'healthy'
def public_component(spec,observation,now=None):
    return {**{k:spec.get(k) for k in ('id','host','kind','name','owner','depends_on','expected','classified','retired')},'importance':spec.get('importance','critical'),'status':assess(spec,observation,now) if spec.get('classified',True) else 'unknown','observation':observation or {}}
def label(value):return json.dumps(str(value),ensure_ascii=True)
def metrics(snapshot):
    lines=['infra_collection_seconds{host='+label(snapshot['host'])+'} '+str(snapshot['collected_at'])]
    for row in snapshot['components']:
        tags=','.join(k+'='+label(row.get(k,"technical-inbox")) for k in ('host','id','kind','name','owner'))+',importance='+label(row.get('importance','critical'))
        for state in ('healthy','unhealthy','unknown','maintenance'):
            lines.append('infra_component_state{'+tags+',state='+label(state)+'} '+str(int(row['status']==state)))
        lines.append('infra_observed_seconds{'+tags+'} '+str(row['observation'].get('observed_at',0)))
        for key in ('restart_count','last_success','last_attempt','duration'):
            if isinstance(row['observation'].get(key),(float,int)):lines.append('infra_'+key+'{'+tags+'} '+str(row['observation'][key]))
    return '\n'.join(lines)+'\n'
