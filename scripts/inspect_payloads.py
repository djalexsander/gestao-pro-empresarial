import os,sqlite3,json,sys

db=os.path.join(os.environ.get('APPDATA','.'),'gestao-pro','local.db')
if not os.path.exists(db):
    print('DB not found',db); sys.exit(0)
con=sqlite3.connect(db)
c=con.cursor()
try:
    c.execute("SELECT payload FROM produtos_local LIMIT 20")
    rows=c.fetchall()
except Exception as e:
    print('error',e); sys.exit(1)
for i,(p,) in enumerate(rows):
    try:
        obj=json.loads(p)
    except Exception as e:
        print(i,'invalid json')
        continue
    keys=sorted(list(obj.keys()))
    print('ROW',i,'keys=',keys)
    for k in ['empresa_id','tenant','owner_id','owner','empresa','empresa_id_remote','tenant_id','tenant_id_remote']:
        if k in obj:
            print('  has',k,':',obj[k])
    print('  id=',obj.get('id'),'nome=',obj.get('nome'))
print('done')
con.close()
