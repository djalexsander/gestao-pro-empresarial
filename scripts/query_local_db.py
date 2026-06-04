import os,sqlite3,sys

db=os.path.join(os.environ.get('APPDATA','.'),'gestao-pro','local.db')
print('DB PATH:',db)
if not os.path.exists(db):
    print('DB not found')
    sys.exit(0)
con=sqlite3.connect(db)
c=con.cursor()
try:
    c.execute("SELECT COUNT(*) FROM produtos_local WHERE deleted_at_ms IS NULL")
    cnt=c.fetchone()[0]
except Exception as e:
    print('count error',e)
    cnt=None
print('produtos_local_count_non_deleted:',cnt)
try:
    c.execute("SELECT COUNT(*) FROM produtos_local")
    total=c.fetchone()[0]
except Exception as e:
    total=None
print('produtos_local_total:',total)
print('\n-- domain_sync_meta for produtos --')
try:
    c.execute("SELECT domain,last_synced_ms,row_count,last_source,last_strategy,last_delta_count,last_remote_cursor_ms,last_attempt_ms FROM domain_sync_meta WHERE domain='produtos'")
    row=c.fetchone()
    print(row)
except Exception as e:
    print('domain_sync_meta error',e)

print('\n-- sample produtos_local payloads (first 8) --')
try:
    c.execute("SELECT id, sku, nome, payload, updated_at_remote_ms,synced_at_ms,deleted_at_ms FROM produtos_local ORDER BY nome ASC LIMIT 8")
    for r in c.fetchall():
        id,sku,nome,payload,updated,synced,deleted=r
        print('-',id,sku,nome,'updated_at_remote_ms=',updated,'synced_at_ms=',synced,'deleted_at_ms=',deleted)
except Exception as e:
    print('list error',e)

print('\n-- last domain_sync_meta rows (all) --')
try:
    c.execute("SELECT domain,last_synced_ms,row_count,last_source,last_strategy,last_delta_count,last_remote_cursor_ms,last_attempt_ms FROM domain_sync_meta ORDER BY last_synced_ms DESC LIMIT 10")
    for r in c.fetchall():
        print(r)
except Exception as e:
    print('meta list error',e)

con.close()
