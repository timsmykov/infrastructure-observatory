"""Merge explicitly supplied snapshots; no implicit SSH, registry, or host access."""
import argparse
import json
from pathlib import Path
from .collector import atomic
from .model import metrics


def aggregate(paths):
    snapshots = []
    hosts = set()
    for path in paths:
        snapshot = json.loads(Path(path).read_text())
        if snapshot.get('schema') != 1 or not isinstance(snapshot.get('components'), list):
            raise ValueError('Unsupported snapshot contract')
        host = snapshot['host']
        if host in hosts:
            raise ValueError('Duplicate host snapshot')
        hosts.add(host)
        snapshots.append(snapshot)
    return snapshots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshots', nargs='+')
    parser.add_argument('--output', required=True)
    parser.add_argument('--prom', required=True)
    args = parser.parse_args()
    snapshots = aggregate(args.snapshots)
    atomic(args.output, json.dumps({'schema': 1, 'snapshots': snapshots}, indent=2))
    atomic(args.prom, ''.join(metrics(snapshot) for snapshot in snapshots))


if __name__ == '__main__':
    main()
