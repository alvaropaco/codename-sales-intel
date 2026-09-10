"""ETL: extracted Receita *SOCIOCSV -> Neo4j import CSVs, filtered to active companies.

Reads the latin-1, semicolon-delimited partner files, SEMI JOINs against a CSV
export of the active companies (cnpj_basic, cnpj, legal_name, ...), and writes
three import CSVs consumed by the cnpj-neo4j LOAD CSV pipeline:
  neo4j_companies.csv, neo4j_persons.csv, neo4j_edges.csv

Run as an in-cluster Job (uid 10001) mounting the data PVC at /data.
"""
import duckdb, glob, os, time

t0 = time.time()
con = duckdb.connect(database='/data/_etl.duckdb')
con.execute("PRAGMA threads=3")
con.execute("SET temp_directory='/data/_duckdb_tmp'")
con.execute("SET memory_limit='6GB'")
con.execute("SET preserve_insertion_order=false")

con.execute("""
CREATE OR REPLACE TABLE comp AS
SELECT cnpj_basic, any_value(cnpj) cnpj, any_value(legal_name) legal_name,
       any_value(trade_name) trade_name, any_value(main_cnae_description) cnae,
       any_value(city_name) city, any_value(state) uf
FROM read_csv('/data/companies_export.csv', header=true, quote='"', all_varchar=true)
GROUP BY cnpj_basic
""")
print("companies:", con.execute("SELECT count(*) FROM comp").fetchone()[0], flush=True)

files = glob.glob('/data/extracted/*/*SOCIOCSV')
con.execute(f"""
CREATE OR REPLACE TABLE soc_f AS
SELECT s.column00 AS cnpj_basic, s.column01 AS ptype, s.column02 AS pname,
       s.column03 AS pdoc, s.column04 AS pqual, s.column05 AS entry_date
FROM read_csv({files!r}, header=false, delim=';', quote='"',
              all_varchar=true, encoding='latin-1', ignore_errors=true) s
SEMI JOIN comp c ON s.column00 = c.cnpj_basic
WHERE s.column02 IS NOT NULL AND s.column02 <> ''
""")
print("socios filtered:", con.execute("SELECT count(*) FROM soc_f").fetchone()[0], flush=True)

con.execute("""COPY (SELECT cnpj_basic, cnpj, legal_name, trade_name, cnae, city, uf FROM comp)
               TO '/data/neo4j_companies.csv' (HEADER, DELIMITER ',')""")
con.execute("""COPY (SELECT pdoc AS doc, pname AS name, min(ptype) AS ptype
               FROM soc_f GROUP BY pdoc, pname) TO '/data/neo4j_persons.csv' (HEADER, DELIMITER ',')""")
con.execute("""COPY (SELECT pdoc AS doc, pname AS name, cnpj_basic, pqual AS qual, entry_date
               FROM soc_f) TO '/data/neo4j_edges.csv' (HEADER, DELIMITER ',')""")
con.close()
os.remove('/data/_etl.duckdb')
print(f"TOTAL {time.time()-t0:.1f}s", flush=True)
