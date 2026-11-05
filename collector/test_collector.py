import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service_metrics.collector import collect
from service_metrics.model import assess, component_id, metrics
from service_metrics.aggregate import aggregate


class CollectorTests(unittest.TestCase):
    def test_generic_host_and_strict_scope(self):
        self.assertEqual(component_id('sample-node', 'unit', 'api.service'), component_id('sample-node', 'unit', 'api.service'))
        with self.assertRaises(ValueError):
            component_id('bad host', 'unit', 'api.service')

    def test_stale_missing_and_maintenance(self):
        spec = {'kind': 'unit'}
        self.assertEqual(assess(spec, None, 1000), 'unknown')
        self.assertEqual(assess(spec, {'observed_at': 1, 'state': 'active'}, 1000), 'unknown')
        self.assertEqual(assess({**spec, 'expected': 'inactive'}, {'observed_at': 1000, 'state': 'inactive'}, 1000), 'maintenance')

    @patch('service_metrics.collector.run')
    def test_new_discovery_is_unclassified_and_source_failure_visible(self, run):
        run.side_effect = [json.dumps([{'unit': 'new.service', 'active': 'active', 'sub': 'running'}]), OSError('unavailable')]
        s = collect({'components': []}, 'sample-node')
        self.assertEqual(s['components'][0]['status'], 'unknown')
        self.assertIn('docker_unavailable', s['source_errors'])
        self.assertIn('state="unknown"} 1', metrics(s))

    def test_aggregate_rejects_duplicate_host(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'snapshot.json'
            p.write_text(json.dumps({'schema': 1, 'host': 'sample-node', 'components': []}))
            self.assertEqual(len(aggregate([p])), 1)
            with self.assertRaises(ValueError):
                aggregate([p, p])


if __name__ == '__main__':
    unittest.main()
