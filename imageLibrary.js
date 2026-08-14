'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_ROOT = path.join(__dirname, 'public', 'assets', 'images');
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const CATEGORY_META = {
  food: { label: 'Food', icon: '🍔' },
  tools: { label: 'Tools', icon: '🔧' },
  furniture: { label: 'Furniture', icon: '🛋️' },
  countries: { label: 'Countries', icon: '🌍' },
  footballPlayers: { label: 'Football Players', icon: '⚽' },
  celebrities: { label: 'Celebrities', icon: '⭐' },
  animals: { label: 'Animals', icon: '🐾' },
  mixed: { label: 'Mixed', icon: '🎲' },
};

const CATEGORY_DIRS = {
  food: 'food',
  tools: 'tools',
  furniture: 'furniture',
  countries: 'countries',
  footballPlayers: 'football-players',
  celebrities: 'celebrities',
  animals: 'animals',
};

function humanizeFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function makeId(categoryId, filename) {
  const base = path.basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${categoryId}-${base || 'image'}`;
}

function scanCategory(categoryId) {
  const dirName = CATEGORY_DIRS[categoryId];

  if (!dirName) return [];

  const dir = path.join(IMAGE_ROOT, dirName);

  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(filename =>
      SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase())
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    )
    .map(filename => ({
      id: makeId(categoryId, filename),
      name: humanizeFilename(filename),
      filename,
      category: categoryId,
      relativePath: path.join(dirName, filename),
    }));
}

function getCategoryImages(categoryId) {
  return scanCategory(categoryId);
}

function getAllImages() {
  const result = {};

  for (const categoryId of Object.keys(CATEGORY_DIRS)) {
    result[categoryId] = scanCategory(categoryId);
  }

  return result;
}

function getCategories() {
  return Object.entries(CATEGORY_META).map(([id, meta]) => ({
    id,
    ...meta,
    imageCount:
      id === 'mixed'
        ? Object.keys(CATEGORY_DIRS)
            .reduce((total, categoryId) => {
              return total + scanCategory(categoryId).length;
            }, 0)
        : scanCategory(id).length,
  }));
}

function getImageById(id) {
  if (!id) return null;

  for (const categoryId of Object.keys(CATEGORY_DIRS)) {
    const found = scanCategory(categoryId).find(img => img.id === id);

    if (found) return found;
  }

  return null;
}

function shuffle(array) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function pickTwoRandom(categoryId) {
  let list;

  if (categoryId === 'mixed') {
    list = Object.keys(CATEGORY_DIRS)
      .flatMap(category => scanCategory(category));
  } else {
    list = scanCategory(categoryId);
  }

  if (list.length < 2) {
    throw new Error(
      `Category "${categoryId}" needs at least 2 images. Found ${list.length}.`
    );
  }

  const shuffled = shuffle(list);

  return [shuffled[0], shuffled[1]];
}

function getImageFilePath(image) {
  if (!image?.relativePath) return null;

  const resolved = path.resolve(IMAGE_ROOT, image.relativePath);
  const root = path.resolve(IMAGE_ROOT) + path.sep;

  if (!resolved.startsWith(root)) return null;

  return resolved;
}

module.exports = {
  IMAGE_ROOT,
  CATEGORY_META,
  getCategories,
  getAllImages,
  getCategoryImages,
  getImageById,
  getImageFilePath,
  pickTwoRandom,
};