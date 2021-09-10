const VERSION = require('../package.json').version;

import { program } from 'commander';

import linguist from './index';

program
	.name('linguist')
	.usage('--analyze [<folder>] [<options...>]')

	.option('-a|--analyze|--analyse [folders...]', 'Analyse the languages of all files in a folder')
	.option('-i|--ignoredFiles <files...>', `A list of file path globs to ignore`)
	.option('-l|--ignoredLanguages <languages...>', `A list of languages to ignore`)
	.option('-c|--categories <categories...>', 'Language categories to include in output')
	.option('-C|--childLanguages [bool]', 'Display child languages instead of their parents', false)
	.option('-j|--json [bool]', 'Display the output as JSON', false)
	.option('-t|--tree <traversal>', 'Which part of the output JSON to display (dot-delimited)')
	.option('-q|--quick [bool]', 'Skip complex language analysis (alias for -{A|I|H|S}=false)', false)
	.option('-V|--keepVendored [bool]', 'Prevent skipping over vendored/generated files', false)
	.option('-B|--keepBinary [bool]', 'Prevent skipping over binary files', false)
	.option('-A|--checkAttributes [bool]', 'Force the checking of gitattributes files', true)
	.option('-I|--checkIgnored [bool]', 'Force the checking of gitignore files', true)
	.option('-H|--checkHeuristics [bool]', 'Apply heuristics to ambiguous languages', true)
	.option('-S|--checkShebang [bool]', 'Check shebang lines for explicit classification', true)

	.helpOption(`-h|--help`, 'Display this help message')
	.version(VERSION, '-v|--version', 'Display the installed version of linguist-js')

program.parse(process.argv);
const args = program.opts();

// Normalise arguments
for (const arg in args) {
	const normalise = (val: any): any => {
		if (typeof val !== 'string') return val;
		val = val.replace(/^=/, '');
		if (val.match(/true$|false$/)) val = val === 'true';
		return val;
	}
	if (Array.isArray(args[arg])) args[arg] = args[arg].map(normalise);
	else args[arg] = normalise(args[arg]);
}

// Run Linguist
if (args.analyze) (async () => {
	// Fetch language data
	const root = args.analyze === true ? '.' : args.analyze;
	const { files, languages, unknown } = await linguist(root, args);
	// Print output
	if (!args.json) {
		const sortedEntries = Object.entries(languages.results).map(([lang, data]) => [lang, data.bytes]).sort((a, b) => a[1] < b[1] ? +1 : -1) as [string, number][];
		const totalBytes = languages.bytes;
		console.log(`Analysed ${files.bytes.toLocaleString()} B from ${files.count} files with linguist-js`);
		console.log(`\n Language analysis results:`);
		let i = 0;
		for (const [lang, bytes] of sortedEntries) {
			const fmtd = {
				index: (++i).toString().padStart(2, ' '),
				lang: lang.padEnd(24, ' '),
				percent: (bytes / (totalBytes || 1) * 100).toFixed(2).padStart(5, ' '),
				bytes: bytes.toLocaleString().padStart(10, ' '),
			}
			console.log(`  ${fmtd.index}. ${fmtd.lang} ${fmtd.percent}% ${fmtd.bytes} B`);
		}
		console.log(` Total: ${totalBytes.toLocaleString()} B`);
		if (unknown.bytes > 0) {
			console.log(`\n Unknown files and extensions:`);
			for (const [name, bytes] of Object.entries(unknown.filenames)) {
				console.log(`  '${name}': ${bytes.toLocaleString()} B`);
			}
			for (const [ext, bytes] of Object.entries(unknown.extensions)) {
				console.log(`  '.${ext}': ${bytes.toLocaleString()} B`);
			}
			console.log(` Total: ${unknown.bytes.toLocaleString()} B`)
		}
	}
	else {
		const data = { files, languages, unknown };
		if (args.tree) {
			const treeParts: string[] = args.tree.split('.');
			let nestedData: Record<string, any> = data;
			for (const part of treeParts) {
				if (!nestedData[part]) throw Error(`TraversalError: Key '${part}' cannot be found on output object.`);
				nestedData = nestedData[part];
			}
			console.log(nestedData);
		}
		else {
			console.log(JSON.stringify(data, null, 2).replace(/{\s+"type".+?}/sg, obj => obj.replace(/\n\s+/g, ' ')));
		}
	}
})();
else {
	console.log(`Welcome to linguist-js, the JavaScript port of GitHub's language analyzer.`);
	console.log(`Type 'linguist --help' for a list of commands.`);
}
