// Redirect de compatibilidade: a página de formação vive em
// /perfil/formacao (e o tile "Formação" abre como bottom-sheet no perfil).
// Deep-links/URLs adivinhadas pra /formacao caíam em 404 — redirecionamos.
import { redirect } from 'next/navigation';

export default function FormacaoRedirect() {
  redirect('/perfil/formacao');
}
