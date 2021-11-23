require('dotenv').config()

module.exports = (body, res) => {

  (async _ => {
    if (!body.search) {
      return res.send({ error: 'No query' })
    }
  
    const DEBUG = true
    const fs = require('fs')
    
    const config = {
      database: process.env.PGDATABASE || 'kafkasearch',
      user: process.env.PGUSER || 'fhirstation',
      host: process.env.PGHOST || 'fhirstation-database-coordinator-0.fhirstation-database-coordinator',
      port: process.env.PGPORT || '5432',
      password: process.env.PGPASSWORD || 'postgres_password_123',
      ssl: {
        rejectUnauthorized: false,
        ca: fs.readFileSync(__dirname + '/tls/root.crt').toString(),
        key: fs.readFileSync(__dirname + '/tls/client_postgres.key').toString(),
        cert: fs.readFileSync(__dirname + '/tls/client_postgres.crt').toString()
      }
    }
    
    const { Pool } = require('pg')
    const clientPool = new Pool(config)
    const pidKillerPool = new Pool(config)
    
    const sqlSelectQuery = queryId => {
      return `
    SELECT /*${queryId}*/
      * from func_identifier(in_identifier_value => $3,
      in_identifier_type => $2,
      in_kafka_topic => $1 ,
      in_kafka_offset => $4,
      in_kafka_partition => null)
    `
    }
    
    const sqlKillQuery = queryId => {
      return `
    WITH pids AS (
      /*notthisone*/
      SELECT pid
      FROM   pg_stat_activity
      WHERE  query LIKE '%/*${queryId}*/%'
      AND    query NOT LIKE '%/*notthisone*/%'
      AND    state='active'
    )
    SELECT pg_cancel_backend(pid) FROM pids;
    `
    }
  
    let data
  
    const {queryId} = body
    DEBUG && console.log('queryId:', queryId)
  
    const query = {
      name: queryId,
      text: sqlSelectQuery(queryId),
      values: [
        body.search.queryKafkaTopic,
        body.search.queryIdentifierType,
        body.search.queryIdentifierValue,
        body.search.queryKafkaOffset ? parseInt(body.search.queryKafkaOffset) : null
      ]
    }
  
    const client = await clientPool.connect()
    const pidKiller = await pidKillerPool.connect()
  
    try {
      await pidKiller.query(sqlKillQuery(queryId))
    } catch (err) {
      DEBUG && console.log(err.message)
    } finally {
      pidKiller.release()
    }
  
    data = await new Promise(async (resolve, reject) => {
      let result
      try {
        result = await client.query(query).catch(_ => console.log('Query was cancelled'))
      } catch (err) {
        reject( { rows: [] } )
        console.log(err.message)
      } finally {
        resolve(result)
        client.release()
      }    
    })
  
    return res.status(200).send(data ? data.rows : [])
  })()

}
