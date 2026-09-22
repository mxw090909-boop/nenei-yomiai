import base64
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from device_backups import handle_backup


class Handler:
    def __init__(self, value=None):
        body=json.dumps(value).encode()
        self.headers={'Content-Length':str(len(body))}
        self.rfile=io.BytesIO(body)
    def json(self, value, status=200): self.result=(status,value)
    def error(self, status, message): self.result=(status,message)


class Backups(unittest.TestCase):
    def test_roundtrip_and_invalid_write_preserves_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            key=['device-backups','a'*64]
            payload={'version':1,'iv':base64.b64encode(b'i'*12).decode(),'data':base64.b64encode(b'c'*32).decode()}
            put=Handler(payload);handle_backup(put,key,path,'PUT');self.assertEqual(put.result[0],200)
            bad=Handler({'version':1,'iv':'bad','data':'bad'});handle_backup(bad,key,path,'PUT');self.assertEqual(bad.result[0],400)
            get=Handler();handle_backup(get,key,path,'GET');self.assertEqual(get.result,(200,payload))
            missing=Handler();handle_backup(missing,['device-backups','b'*64],path,'GET');self.assertEqual(missing.result[0],404)
            invalid=Handler();handle_backup(invalid,['device-backups','../bad'],path,'GET');self.assertEqual(invalid.result[0],400)
            large=Handler(payload);large.headers['Content-Length']=str(49*1024*1024);handle_backup(large,key,path,'PUT');self.assertEqual(large.result[0],413)


if __name__=='__main__': unittest.main()
