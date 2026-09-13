const http = require('http')
const fs = require('fs')
const path = require('path')

const server = http.createServer((req, res) => {
	let filePath = path.join(
		__dirname,
		'public',
		req.url === '/' ? 'index.html' : req.url,
	)

	const ext = path.extname(filePath)

	const contentTypes = {
		'.html': 'text/html',
		'.css': 'text/css',
		'.js': 'text/javascript',
	}

	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404)
			res.end('Not found')
			return
		}

		res.writeHead(200, {
			'Content-Type': contentTypes[ext] || 'text/plain',
		})

		res.end(data)
	})
})

server.listen(3000, () => {
	console.log('Server running at http://localhost:3000')
})
