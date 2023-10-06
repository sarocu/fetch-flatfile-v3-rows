import fetch from 'node-fetch'

// Constants:
const ACCESS_KEY_ID='FF00YB81JS6D5WL294LIJ4WK5CKHQWPJJRS5SETE'
const SECRET_KEY='69y2fWBdWoyoG4ZPFiqBHdaCE3aygn79DrtFOJqf'
const API_KEY=`${ACCESS_KEY_ID}+${SECRET_KEY}`
const BASE_URL='api.us.flatfile.io'
const LICENSE_KEY='78826d47-a0ed-4a62-ade5-defac79f237e'

/*
----------------------------------------------------------------
Because Flatfile V3 uses a backend for frontend pattern for our GraphQL API,
we need to do several things to fetch row error messages:
1. fetch a bearer token for working with the GraphQL API
2. fetch a list of batch IDs (this can be paginated through)
3. fetch the IDs for the underlying datastructure - the workbook
4. fetch the row data
----------------------------------------------------------------
*/

// Bearer token for the GraphQL API:
const fetchBearer = await fetch(`https://${BASE_URL}/auth/access-key/exchange`, {
    method: 'post',
    body: JSON.stringify({
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_KEY
    }),
    headers: 
        {
            'Content-Type': 'application/json',
        }
    
})

const jwt = await fetchBearer.json()

console.log({ jwt })

// Fetch a page of imports:
// See docs for pagination args: https://api.us.flatfile.io/rest/docs/#/batches/RestController_getBatches
let imports = []
const fetchBatchesResponse = await fetch(`https://${BASE_URL}/rest/batches?licenseKey=${LICENSE_KEY}`, {
    method: 'get',
    headers: { 'X-Api-Key': API_KEY}
})

const batches = await fetchBatchesResponse.json()
batches.data.map((batch) => {
    imports.push({id: batch.id, workspace: batch.workspaceId, isSubmitted: batch.status === 'submitted'})
})

console.log(JSON.stringify(imports, null, 4))

// loop through a list of imports, fetching the workbook IDs:
let workbooks = []
await Promise.all(
    imports.map(async (batch) => {
        if (batch.isSubmitted) {
            const query = `
                {
                    getWorkspace(workspaceId: "${batch.workspace}") {
                        primaryWorkbookId
                        primaryWorkbook {
                            sheets {
                                schemaId
                            }
                        }
                    }
                }
            `
        
            // GET row data:
            const ws = await fetch(`https://${BASE_URL}/graphql`, {
                method: 'post',
                body: JSON.stringify({ query}),
                headers: {
                    'Authorization': `Bearer ${jwt.accessToken}`,
                    'Content-Type': 'application/json',
                }
            })
        
            const wsData = await ws.json()
            console.log(JSON.stringify(wsData))
            let wb = {
                id: wsData.data.getWorkspace.primaryWorkbookId,
                schema: wsData.data.getWorkspace.primaryWorkbook.sheets[0].schemaId
            }
            workbooks.push(wb)
        }
    })
)

console.log({ workbooks })

// fetch the rows with errors - "dismissed" rows have errors preventing them from submitting:
let rows = []
await Promise.all(
    workbooks.map(async (wb) => {
        console.log({wb})
        const query = `
            {
                fetchRowsWithSchema(schemaId: ${wb.schema}, workbookId: "${wb.id}", limit:1000, filter:"invalid", status:"dismissed") {
                    rows {
                        status
                        cells
                        validations {
                            error
                            key
                            message
                        }
                    }
                }
            }
        `

        const rowValQuery = await fetch(`https://${BASE_URL}/graphql`, {
            method: 'post',
            body: JSON.stringify({ query }),
            headers: {
                'Authorization': `Bearer ${jwt.accessToken}`,
                'Content-Type': 'application/json',
            }
        })

        const rowVals = await rowValQuery.json()
        const messages = rowVals.data?.fetchRowsWithSchema.rows.map((row) => {
            return row.validations.reduce((acc, cur) => {
                return acc = [cur.message, ...acc]
            }, [])

        })
        console.log({messages})
        if (messages) rows = [...rows, ...messages]
    })

)

console.log(rows, null, 4)

// write the errors to a file:
// @to-do