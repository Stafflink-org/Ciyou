// Traductions propres au back-office super admin (le socle commun est dans @golink/web).
// Convention : un fichier JSON par espace de noms et par langue, voir docs/I18N.md.
import { addResources, type TranslationTree } from '@golink/web';
import frNav from './fr/nav.json';
import enNav from './en/nav.json';
import arNav from './ar/nav.json';
import frAuth from './fr/auth.json';
import enAuth from './en/auth.json';
import arAuth from './ar/auth.json';
import frAccueil from './fr/accueil.json';
import enAccueil from './en/accueil.json';
import arAccueil from './ar/accueil.json';

addResources('fr', 'nav', frNav as TranslationTree);
addResources('en', 'nav', enNav as TranslationTree);
addResources('ar', 'nav', arNav as TranslationTree);
addResources('fr', 'auth', frAuth as TranslationTree);
addResources('en', 'auth', enAuth as TranslationTree);
addResources('ar', 'auth', arAuth as TranslationTree);
addResources('fr', 'accueil', frAccueil as TranslationTree);
addResources('en', 'accueil', enAccueil as TranslationTree);
addResources('ar', 'accueil', arAccueil as TranslationTree);
