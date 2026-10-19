import { route, startRouter } from './router.js';
import { registerServiceWorker } from './pwa.js';
import { projectsView } from './views/projects.js';
import { recipesView, recipeView, recipeFormView } from './views/recipes.js';
import { projectView } from './views/project.js';
import { patternView, patternEditorView } from './views/pattern.js';
import { fileView } from './views/viewer.js';
import { chartEditorView } from './views/chart-editor.js';
import { needlesView } from './views/needles.js';
import { moreView } from './views/more.js';

route(/^\/prosjekter$/, 'prosjekter', projectsView);
route(/^\/oppskrifter$/, 'oppskrifter', recipesView);
route(/^\/pinner$/, 'pinner', needlesView);
route(/^\/mer$/, 'mer', moreView);
route(/^\/ny$/, null, () => recipeFormView(null));
route(/^\/oppskrift\/([^/]+)$/, null, recipeView);
route(/^\/oppskrift\/([^/]+)\/rediger$/, null, recipeFormView);
route(/^\/oppskrift\/([^/]+)\/nytt-monster$/, null, (m, q) => patternEditorView(m, q));
route(/^\/monster\/([^/]+)$/, null, patternView);
route(/^\/monster\/([^/]+)\/rediger$/, null, (m, q) => patternEditorView(m, q, { editId: m[1] }));
route(/^\/monster\/([^/]+)\/diagram$/, null, chartEditorView);
route(/^\/prosjekt\/([^/]+)$/, null, projectView);
route(/^\/fil\/([^/]+)$/, null, fileView);

startRouter();
registerServiceWorker();
