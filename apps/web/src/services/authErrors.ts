/**
 * Centralized, user-facing mapping for authentication errors.
 *
 * The Firebase Web SDK and the backend both expose technical error codes (and
 * occasionally raw localized messages). The UI must never surface those codes
 * directly: every failure is translated to friendly Portuguese copy here, with
 * a safe generic fallback for anything unknown.
 */

export interface AuthErrorLike {
  code?: string;
  message?: string;
}

export function getErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const code = (error as AuthErrorLike).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Firebase Web SDK (firebase/auth)
  'auth/popup-blocked':
    'O navegador bloqueou a janela de login. Permita popups para este site e tente novamente.',
  'auth/popup-closed-by-user': 'O login foi cancelado antes de terminar. Tente novamente.',
  'auth/cancelled-popup-request':
    'Havia outra tentativa de login em andamento. Tente novamente.',
  'auth/operation-not-supported-in-this-environment':
    'Este método de login não é compatível com o seu navegador. Tente outro navegador ou use e-mail e senha.',
  'auth/operation-not-allowed':
    'Este método de login não está habilitado. Entre em contato com o administrador.',
  'auth/unauthorized-domain':
    'Este endereço não está autorizado para o login. Verifique os domínios autorizados no Firebase.',
  'auth/unauthorized-continue-uri':
    'O endereço de retorno do login não está autorizado. Verifique os domínios autorizados no Firebase.',
  'auth/invalid-api-key':
    'A configuração do login está inválida. Entre em contato com o administrador.',
  'auth/app-not-authorized':
    'O aplicativo não está autorizado a usar este login. Entre em contato com o administrador.',
  'auth/network-request-failed':
    'Falha de conexão. Verifique sua internet e tente novamente.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
  'auth/internal-error': 'Erro interno de autenticação. Tente novamente.',
  'auth/user-disabled': 'Esta conta foi desativada. Entre em contato com o suporte.',
  'auth/user-not-found': 'Nenhuma conta encontrada com estes dados. Verifique e tente novamente.',
  'auth/wrong-password': 'Senha incorreta. Tente novamente.',
  'auth/invalid-credential': 'E-mail ou senha incorretos. Verifique e tente novamente.',
  'auth/invalid-email': 'E-mail inválido. Verifique e tente novamente.',
  'auth/email-already-in-use': 'Este e-mail já está em uso. Faça login ou use outro e-mail.',
  'auth/weak-password': 'A senha é muito fraca. Use pelo menos 6 caracteres.',
  'auth/account-exists-with-different-credential':
    'Já existe uma conta com este e-mail em outro método de login. Entre com o método usado anteriormente.',
  'auth/credential-already-in-use': 'Estas credenciais já estão vinculadas a outra conta.',
  'auth/provider-already-linked': 'Este provedor já está vinculado à sua conta.',
  'auth/requires-recent-login': 'Por segurança, entre novamente para continuar.',
  'auth/invalid-verification-code':
    'Código de verificação inválido. Confira o código e tente novamente.',
  'auth/missing-verification-code': 'Informe o código de verificação recebido por SMS.',
  'auth/code-expired': 'O código de verificação expirou. Solicite um novo código.',
  'auth/invalid-phone-number':
    'Número de telefone inválido. Use o formato internacional, ex.: +5511999999.',
  'auth/quota-exceeded': 'Limite de envios atingido. Tente novamente mais tarde.',

  // Backend session / token verification codes (firebase-auth.js)
  'EMAIL_NOT_VERIFIED':
    'Seu e-mail ainda não foi verificado. Verifique sua caixa de entrada antes de continuar.',
  'NON_CORPORATE_EMAIL': 'Apenas e-mails corporativos são permitidos nesta plataforma.',
  'UNAUTHENTICATED': 'Sua sessão não está ativa. Entre novamente.',
  'SESSION_EXPIRED': 'Sua sessão expirou. Entre novamente.',
  'SESSION_REVOKED': 'Sua sessão foi encerrada. Entre novamente.',
  'AUTH_FAILED': 'Não foi possível autenticar. Tente novamente.',
  'AUTH_ERROR': 'Não foi possível validar sua sessão. Tente novamente.',
  'USER_NOT_FOUND': 'Usuário não encontrado. Entre novamente.',
  'MISSING_ID_TOKEN': 'Não foi possível iniciar a sessão. Tente novamente.',
  'IDENTITY_NOT_FOUND':
    'Não foi possível identificar seu e-mail ou telefone. Tente outro método de login.',
};

export function getAuthErrorMessage(
  error: unknown,
  fallback = 'Não foi possível concluir a autenticação. Tente novamente.'
): string {
  const code = getErrorCode(error);
  if (code && AUTH_ERROR_MESSAGES[code]) return AUTH_ERROR_MESSAGES[code];

  // Last resort for SDK errors that only carry a raw (localized) message.
  if (error && typeof error === 'object') {
    const message = (error as AuthErrorLike).message;
    if (typeof message === 'string') {
      if (/popup|closed by user|blocked/i.test(message)) {
        return AUTH_ERROR_MESSAGES['auth/popup-closed-by-user'];
      }
      if (/network|fetch|offline|internet/i.test(message)) {
        return AUTH_ERROR_MESSAGES['auth/network-request-failed'];
      }
    }
  }

  return fallback;
}
