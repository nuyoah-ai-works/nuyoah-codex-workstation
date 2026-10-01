"""Exercise exact retrieval, large-record boundaries and archive protection."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

SCRIPT = Path(__file__).with_name('cold_history.py')


def main():
    with tempfile.TemporaryDirectory(prefix='cold-history-test-') as temp:
        archive = Path(temp)
        assert archive.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())

        def run(*args, ok=True):
            result = subprocess.run(
                [sys.executable, '-X', 'utf8', str(SCRIPT), '--archive', str(archive), *map(str, args)],
                capture_output=True, text=True, encoding='utf-8',
            )
            assert (result.returncode == 0) == ok, result.stdout + result.stderr
            return result.stdout

        def line(kind, payload):
            return (json.dumps({'timestamp': '2026-09-04T00:00:00Z', 'type': kind, 'payload': payload}, ensure_ascii=False) + '\n').encode()

        first = line('session_meta', {'id': 'fixture'})
        early = line('event_msg', {'type': 'user_message', 'message': '旧意见：连续累积，不能每次重置。'})
        huge = line('compacted', {'replacement_history': [{'text': 'x' * (2 * 1024 * 1024)}]})
        large_message = line('event_msg', {'type': 'user_message', 'message': '长原话' + 'x' * (1024 * 1024)})
        latest = line('event_msg', {'type': 'agent_message', 'message': '已保留连续累积。'})[:-1]
        raw = first + early + huge + large_message + latest
        source = archive / 'original.jsonl'
        source.write_bytes(raw)
        report = json.loads(run('index'))
        assert report['records'] == 5 and report['messages'] == 2
        assert report['oversized_messages'] == 1
        hits = [json.loads(s) for s in run('search', '连续累积', '--limit', '2').splitlines()]
        assert [h['record'] for h in hits] == [5, 2]
        assert json.loads(run('show', '2'))['text'] == '旧意见：连续累积，不能每次重置。'
        assert json.loads(run('show', '2', '--chars', '3'))['truncated'] is True
        assert run('search', '不存在') == ''
        with closing(sqlite3.connect(archive / 'cold-index.sqlite')) as db:
            assert db.execute('SELECT offset,length FROM records WHERE id=4').fetchone() == (len(first + early + huge), len(large_message))
        target = archive / 'record.jsonl'
        run('export', '3', target)
        assert target.read_bytes() == huge
        run('export', '2', target, ok=False)
        assert target.read_bytes() == huge
        run('index', ok=False)
        run('search', ' ', ok=False)
        run('show', '99', ok=False)
        assert source.read_bytes() == raw
        source.write_bytes(raw + b'\n')
        run('export', '2', archive / 'stale.jsonl', ok=False)
        assert not (archive / 'stale.jsonl').exists()
        source.write_bytes(raw)
        # Existing archives created by the original utility have the same two tables.
        assert json.loads(run('show', '5'))['role'] == 'assistant'
    with tempfile.TemporaryDirectory(prefix='cold-history-invalid-') as temp:
        archive = Path(temp)
        assert archive.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())
        (archive / 'original.jsonl').write_bytes(b'{broken json}\n')
        run('index', ok=False)
        assert not (archive / 'cold-index.sqlite').exists()
    print('PASS: cold history index, exact retrieval, bounded output, archive protection')


if __name__ == '__main__':
    main()
