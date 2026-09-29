// Toast — message éphémère en bas d'écran (confirmations, erreurs de stock,
// codes promo…), très utilisé par le parcours d'achat (§4 à §10 client.md).
// Un seul toast à la fois (le suivant remplace le précédent), disparaît seul.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing } from '../theme/tokens';
import { Text } from './Text';

interface ToastState {
  id: number;
  message: string;
  tone: 'default' | 'danger';
}

export interface ToastContextValue {
  show: (message: string, tone?: 'default' | 'danger') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, tone: 'default' | 'danger' = 'default') => {
      if (timer.current) clearTimeout(timer.current);
      const id = Date.now();
      setToast({ id, message, tone });
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
          setToast((current) => (current?.id === id ? null : current));
        });
      }, 2600);
    },
    [opacity],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + spacing.xl, opacity }]}>
          <View style={[styles.bubble, toast.tone === 'danger' && styles.bubbleDanger]}>
            <Text variant="bodyStrong" style={{ color: colors.onDark }} align="center">
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous ToastProvider.');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  bubble: { backgroundColor: colors.ink, paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.lg, maxWidth: 420, ...shadow.card },
  bubbleDanger: { backgroundColor: colors.danger },
});
