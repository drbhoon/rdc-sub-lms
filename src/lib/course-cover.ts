/** Four brand-toned cover colours, picked from the title so a course always gets the same one. */
const COVERS = ["#1f3a8a", "#0f766e", "#7c3aed", "#b45309"];

export const coverFor = (title: string) => COVERS[[...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COVERS.length];
