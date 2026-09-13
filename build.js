const fs = require("fs");
const path = require("path");
const CleanCSS = require("clean-css");
const { minify: minifyHtml } = require("html-minifier-terser");
const { minify: minifyJavaScript } = require("terser");

const sourceDirectory = path.join(__dirname, "public");
const outputDirectory = path.join(__dirname, "build");

async function build() {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    const files = fs.readdirSync(sourceDirectory);

    for (const file of files) {
        const sourcePath = path.join(sourceDirectory, file);
        const outputPath = path.join(outputDirectory, file);
        const extension = path.extname(file);
        const source = fs.readFileSync(sourcePath, "utf8");
        let output = source;

        if (extension === ".html") {
            output = await minifyHtml(source, {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true
            });
        } else if (extension === ".css") {
            const result = new CleanCSS({ level: 2 }).minify(source);

            if (result.errors.length > 0) {
                throw new Error(
                    `Could not minify ${file}: ${result.errors.join(", ")}`
                );
            }

            output = result.styles;
        } else if (extension === ".js") {
            const result = await minifyJavaScript(source);

            if (!result.code) {
                throw new Error(`Could not minify ${file}.`);
            }

            output = result.code;
        }

        fs.writeFileSync(outputPath, output);
    }

    console.log(`Built ${files.length} files in ${path.relative(__dirname, outputDirectory)}/`);
}

build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
