from datetime import datetime
from typing import Generator, Tuple, Any, List

import psycopg2.pool
import rootpath
from deprecated import deprecated

rootpath.append()
from paths import DATABASE_CONFIG_PATH
from utilities.ini_parser import parse


class Connection:
    _pool = None

    def __init__(self):
        self.conn = None
        if not Connection._pool:
            Connection._pool = psycopg2.pool.ThreadedConnectionPool(1, 5, **self.config())

    def __enter__(self, *args, **kwargs):
        """Context Manager enter point, returns an available connection from the _pool"""
        # TODO: save the reference to thread-name or other identifiers (using getconn(key=Thread-name)
        self.conn = Connection._pool.getconn(*args, **kwargs)
        self.get_connection_status(self.conn)
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context Manager exit point, put the occupied connection back into the _pool"""
        Connection._pool.putconn(self.conn)

    @staticmethod
    @deprecated(reason="__call__ will no longer be provided in future, please always use context manager (with)")
    def __call__(*args, **kwargs):
        """returns a newly created connection, which is not maintained by the _pool"""
        connection = psycopg2.connect(*args, **Connection.config(), **kwargs)
        Connection.get_connection_status(connection)
        return connection

    @staticmethod
    def config():
        return parse(DATABASE_CONFIG_PATH, 'postgresql')

    @staticmethod
    def get_connection_status(connection):
        cursor = connection.cursor()
        cursor.execute("SELECT sum(numbackends) FROM pg_stat_database;")
        connection_count, = cursor.fetchone()
        cursor.execute("SHOW max_connections;")
        connection_max_count, = cursor.fetchone()
        # adding this log to show current database connection status
        print(
            f"[DATABASE] HOST = {Connection.config().get('host')}, CONNECTION COUNT "
            f"= {connection_count}, MAXIMUM = {connection_max_count}")
        cursor.close()

    @staticmethod
    def sql_execute(sql: str) -> Generator[Tuple[Any], None, None]:
        """to execute an SQL query and iterate the output"""
        print(f"SQL: {sql}")
        if any([keyword in sql.upper() for keyword in ["INSERT", "UPDATE"]]):
            print("You are running INSERT or UPDATE without committing, transaction aborted. Please retry with "
                  "sql_execute_commit")
            return
        with Connection() as connection:
            cursor = connection.cursor()
            cursor.execute(sql)

            try:
                one_row = cursor.fetchone()
                while one_row:
                    yield one_row
                    one_row = cursor.fetchone()
            except psycopg2.ProgrammingError:
                pass
            finally:
                cursor.close()

    @staticmethod
    def sql_execute_commit(sql: str) -> None:
        """to execute and commit an SQL query"""
        print(f"SQL: {sql}")
        with Connection() as connection:
            cursor = connection.cursor()
            cursor.execute(sql)
            connection.commit()
            print(f"     Affected rows:{cursor.rowcount}")
            cursor.close()

    @staticmethod
    def sql_execute_values(sql: str, value_tuples: List[Tuple[Any]], ignore_duplicate: bool = True) -> None:
        """to execute and commit an SQL query with multiple value tuples"""
        value_tuples_sql = ", ".join(
            [f"({', '.join([repr(str(entry)) if isinstance(entry, datetime) else repr(entry) for entry in entries])})"
             for entries in value_tuples])
        if value_tuples_sql:
            sql += " " + value_tuples_sql + f" ON CONFLICT DO NOTHING" if ignore_duplicate else ""
            Connection.sql_execute_commit(sql)
        else:
            print("[DATABASE] Nothing to commit")


if __name__ == '__main__':
    # use as a context contextmanager
    with Connection() as conn:
        cur = conn.cursor()
        cur.execute("select * from pg_tables")
        print(cur.fetchall())
        cur.close()

    # use a non-managed Connection, not maintained by connection pool, need to be closed manually.
    # TODO: remove the support for such usage, once other depended modules are updated.
    conn = Connection()()  # call the object to return a new connection
    cur = conn.cursor()
    cur.execute("select * from pg_tables")
    print(cur.fetchall())
    cur.close()
    conn.close()  # user should close it manually

    # execute sql directly, with output fetched iteratively
    for row in Connection.sql_execute("select * from pg_tables"):
        print(row)

    # remains supported for now.
    for row in Connection().sql_execute("select * from pg_tables"):
        print(row)
