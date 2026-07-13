import { writable } from 'svelte/store';

export type Category = 'highlights' | 'notes' | 'playlists' | 'tags' | 'bookmarks' | 'inputFields';
export const selectedCategory = writable<Category | null>(null);
export const selectedMonth = writable<string | null>(null); // 'YYYY-MM' from timeline click
