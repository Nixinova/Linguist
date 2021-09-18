import fs from 'fs';
import paths from 'path';
import yaml from 'js-yaml';
import fetch from 'cross-fetch';
import classificator from 'classificator';
import glob2regex from 'glob-to-regexp';
import binaryData from 'binary-extensions';
import { isBinaryFile } from 'isbinaryfile';

import walk from './helpers/walk-tree';
import { loadFile, loadApi } from './helpers/load-data';
import readFile from './helpers/read-file';
import pcre from './helpers/convert-pcre';
import * as T from './types';
import * as S from './schema';

const convertToRegex = (path: string): RegExp => glob2regex('**/' + path, { globstar: true, extended: true });

async function analyse(path?: string, opts?: T.Options): Promise<T.Results>
async function analyse(paths?: string[], opts?: T.Options): Promise<T.Results>
async function analyse(input?: string | string[], opts: T.Options = {}): Promise<T.Results> {
	const langData = <S.LanguagesScema>await loadFile('lib/linguist/languages.yml').then(yaml.load);
	const vendorData = <S.VendorSchema>await loadFile('lib/linguist/vendor.yml').then(yaml.load);
	const heuristicsData = <S.HeuristicsSchema>await loadFile('lib/linguist/heuristics.yml').then(yaml.load);
	const generatedData = await loadFile('lib/linguist/generated.rb').then(text => text.match(/(?<=name\.match\(\/).+?(?=(?<!\\)\/\))/gm) ?? []);
	vendorData.push(...generatedData);

	const fileAssociations: Record<T.FilePath, T.LanguageResult[]> = {};
	const extensions: Record<T.FilePath, string> = {};
	const overrides: Record<T.FilePath, T.LanguageResult> = {};
	const results: T.Results = {
		files: { count: 0, bytes: 0, results: {} },
		languages: { count: 0, bytes: 0, results: {} },
		unknown: { count: 0, bytes: 0, extensions: {}, filenames: {} },
	}

	const ignoredFiles = [
		/\/\.git\//,
		opts.keepVendored ? [] : vendorData.map(path => pcre(path)),
		opts.ignoredFiles?.map(path => glob2regex('*' + path + '*', { extended: true })) ?? [],
	].flat();
	let { files, folders } = walk(input ?? '.', ignoredFiles);

	// Apply aliases
	opts = { checkIgnored: !opts.quick, checkAttributes: !opts.quick, checkHeuristics: !opts.quick, checkShebang: !opts.quick, ...opts };

	// Ignore specific languages
	for (const lang of opts.ignoredLanguages ?? []) {
		for (const key in langData) {
			if (lang.toLowerCase() === key.toLowerCase()) {
				delete langData[key];
				break;
			}
		}
	}

	// Load gitattributes
	const customIgnored: string[] = [];
	const customBinary: string[] = [];
	const customText: string[] = [];
	if (!opts.quick) {
		for (const folder of folders) {

			// Skip if folder is marked in gitattributes
			if (customIgnored.some(path => pcre(path).test(folder))) continue;

			// Parse gitignores
			const ignoresFile = paths.join(folder, '.gitignore');
			if (opts.checkIgnored && fs.existsSync(ignoresFile)) {
				const ignoresData = await readFile(ignoresFile);
				const ignoresList = ignoresData.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
				const ignoredPaths = ignoresList.map(path => convertToRegex(path).source);
				customIgnored.push(...ignoredPaths.map(file => file.replace(folder, '')));
			}

			// Parse gitattributes
			const attributesFile = paths.join(folder, '.gitattributes');
			if (opts.checkAttributes && fs.existsSync(attributesFile)) {
				const attributesData = await readFile(attributesFile);
				const relPathToRegex = (path: string): string => convertToRegex(path).source.substr(1).replace(folder, '');
				// Explicit text/binary associations
				const contentTypeMatches = attributesData.matchAll(/^(\S+).*?(-?binary|-?text)/gm);
				for (const [_line, path, type] of contentTypeMatches) {
					if (['text', '-binary'].includes(type)) customText.push(relPathToRegex(path));
					if (['-text', 'binary'].includes(type)) customBinary.push(relPathToRegex(path));
				}
				// Custom vendor options
				const vendorMatches = attributesData.matchAll(/^(\S+).*[^-]linguist-(vendored|generated|documentation)(?!=false)/gm);
				for (const [_line, path] of vendorMatches) {
					customIgnored.push(relPathToRegex(path));
				}
				// Custom file associations
				const customLangMatches = attributesData.matchAll(/^(\S+).*[^-]linguist-language=(\S+)/gm);
				for (let [_line, path, forcedLang] of customLangMatches) {
					// If specified language is an alias, associate it with its full name
					if (!langData[forcedLang]) {
						const overrideLang = Object.entries(langData).find(entry => entry[1].aliases?.includes(forcedLang.toLowerCase()));
						if (overrideLang) forcedLang = overrideLang[0];
					}
					const fullPath = folder + convertToRegex(path).source.substr(1);
					overrides[fullPath] = forcedLang;
				}
			}

		}
	}
	// Check vendored files
	if (!opts.keepVendored) {
		// Filter out any files that match a vendor file path
		const matcher = (match: string) => pcre(match.replace(/\/$/, '/.+$').replace(/^\.\//, ''));
		files = files.filter(file => !customIgnored.some(pattern => matcher(pattern).test(file)));
	}

	// Load all files and parse languages
	const addResult = (file: string, result: T.LanguageResult) => {
		if (!fileAssociations[file]) {
			fileAssociations[file] = [];
			extensions[file] = '';
		}
		const parent = !opts.childLanguages && result && langData[result].group || false;
		fileAssociations[file].push(parent || result);
		extensions[file] = paths.extname(file);
	}
	const overridesArray = Object.entries(overrides);
	// List all languages that could be associated with a given file
	for (const file of files) {
		if (!fs.existsSync(file) || fs.lstatSync(file).isDirectory()) continue;
		// Check shebang line for explicit classification
		if (!opts.quick && opts.checkShebang) {
			const firstLine = await readFile(file, true);
			if (firstLine.startsWith('#!')) {
				const matches = Object.entries(langData).filter(([, data]) =>
					data.interpreters?.some(interpreter => firstLine.match('\\b' + interpreter + '\\b'))
				);
				if (matches.length) {
					const forcedLang = matches[0][0];
					addResult(file, forcedLang);
					continue;
				}
			}
		}
		// Check override for manual language classification
		if (!opts.quick && opts.checkAttributes) {
			const match = overridesArray.find(item => RegExp(item[0]).test(file));
			if (match) {
				const forcedLang = match[1];
				addResult(file, forcedLang);
				continue;
			}
		}
		// Search each language
		let skipExts = false;
		for (const lang in langData) {
			// Check if filename is a match
			const matchesName = langData[lang].filenames?.some(name => paths.basename(file.toLowerCase()) === name.toLowerCase());
			if (matchesName) {
				addResult(file, lang);
				skipExts = true;
			}
		}
		if (!skipExts) for (const lang in langData) {
			// Check if extension is a match
			const matchesExt = langData[lang].extensions?.some(ext => file.toLowerCase().endsWith(ext.toLowerCase()));
			if (matchesExt) addResult(file, lang);
		}
		// Fallback to null if no language matches
		if (!fileAssociations[file]) addResult(file, null);
	}
	// Narrow down file associations to the best fit
	for (const file in fileAssociations) {
		// Skip binary files
		if (!opts.keepBinary) {
			const isCustomText = customText.some(path => pcre(path).test(file));
			const isCustomBinary = customBinary.some(path => pcre(path).test(file));
			const isBinaryExt = binaryData.some(ext => file.endsWith('.' + ext));
			if (!isCustomText && (isCustomBinary || isBinaryExt || await isBinaryFile(file))) {
				continue;
			}
		}

		// Parse heuristics if applicable
		if (opts.checkHeuristics) for (const heuristics of heuristicsData.disambiguations) {
			// Make sure the extension matches the current file
			if (!heuristics.extensions.includes(extensions[file])) {
				continue;
			}
			// Load heuristic rules
			for (const heuristic of heuristics.rules) {
				// Make sure the language is not an array
				if (Array.isArray(heuristic.language)) {
					heuristic.language = heuristic.language[0];
				}
				// Make sure the results includes this language
				const matchesLang = fileAssociations[file].includes(heuristic.language);
				const matchesParent = langData[heuristic.language].group && fileAssociations[file].includes(langData[heuristic.language].group!);
				if (!matchesLang && !matchesParent) continue;
				// Normalise heuristic data
				const patterns: string[] = [];
				const normalise = (contents: string | string[]) => patterns.push(...(Array.isArray(contents) ? contents : [contents]));
				if (heuristic.pattern) normalise(heuristic.pattern);
				if (heuristic.named_pattern) normalise(heuristicsData.named_patterns[heuristic.named_pattern]);
				// Check file contents and apply heuristic patterns
				const fileContent = await readFile(file);
				if (!patterns.length || patterns.some(pattern => pcre(pattern).test(fileContent))) {
					results.files.results[file] = heuristic.language;
					break;
				}
			}
		}
		if (/* opts.checkSamples && */ !results.files.results[file] && fileAssociations[file].length > 1) {
			// Bayesian classifier
			const samples = (<S.GitHubTreeSchema>await loadApi('git/trees/HEAD?recursive=1')).tree;
			const classifier = classificator();
			for (const testLang of fileAssociations[file]) if (testLang) {
				const applicableSamples = samples.filter(obj => obj.type === 'blob' && obj.path.startsWith(`samples/${testLang}`));
				console.debug({ testLang, sample: applicableSamples[0].path })
				const sampleContent = await loadFile(applicableSamples[0].path);
				classifier.learn(sampleContent, testLang);
			}
			const result = classifier.categorize(`whatever`);
			console.debug('result', result.predictedCategory, result.likelihoods.map(({ category, proba }) => ({ category, proba })));
			results.files.results[file] = result.predictedCategory;
		}
		else results.files.results[file] ??= fileAssociations[file][0];
	}

	// Skip specified categories
	if (opts.categories?.length) {
		const categories: T.Category[] = ['data', 'markup', 'programming', 'prose'];
		const hiddenCategories = categories.filter(cat => !opts.categories!.includes(cat));
		for (const [file, lang] of Object.entries(results.files.results)) {
			if (!hiddenCategories.some(cat => lang && langData[lang]?.type === cat)) continue;
			delete results.files.results[file];
			if (lang) delete results.languages.results[lang];
		}
		for (const category of hiddenCategories) {
			for (const [lang, { type }] of Object.entries(results.languages.results)) {
				if (type === category) delete results.languages.results[lang];
			}
		}
	}

	// Load language bytes size
	for (const [file, lang] of Object.entries(results.files.results)) {
		if (lang && !langData[lang]) continue;
		const fileSize = fs.statSync(file).size;
		results.files.bytes += fileSize;
		// If no language found, add extension in other section
		if (!lang) {
			const ext = paths.extname(file);
			const unknownType = ext === '' ? 'filenames' : 'extensions';
			const name = ext === '' ? paths.basename(file) : ext;
			results.unknown[unknownType][name] ??= 0;
			results.unknown[unknownType][name] += fileSize;
			results.unknown.bytes += fileSize;
			continue;
		}
		// Add language and bytes data to corresponding section
		const { type } = langData[lang];
		results.languages.results[lang] ??= { type, bytes: 0, color: langData[lang].color };
		if (opts.childLanguages) results.languages.results[lang].parent = langData[lang].group;
		results.languages.results[lang].bytes += fileSize;
		results.languages.bytes += fileSize;
	}

	// Set counts
	results.files.count = Object.keys(results.files.results).length;
	results.languages.count = Object.keys(results.languages.results).length;
	results.unknown.count = Object.keys({ ...results.unknown.extensions, ...results.unknown.filenames }).length;

	// Return
	return results;
}
export = analyse;
