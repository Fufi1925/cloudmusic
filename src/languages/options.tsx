import type { SelectOption } from "@/shared/ui/Select";
import type { Locale } from "./locale";
import { LanguageFlag } from "./LanguageFlag";

// shared locale options used across auth-wall and settings modal
export const LOCALE_OPTIONS: SelectOption<Locale>[] = [
  {
    value: "en",
    label: "English",
    icon: <LanguageFlag locale="en" />,
  },
  {
    value: "es",
    label: "Español",
    icon: <LanguageFlag locale="es" />,
  },
  {
    value: "ru",
    label: "Русский",
    icon: <LanguageFlag locale="ru" />,
  },
  {
    value: "uk",
    label: "Українська",
    icon: <LanguageFlag locale="uk" />,
  },
  {
    value: "de",
    label: "Deutsch",
    icon: <LanguageFlag locale="de" />,
  },
  {
    value: "it",
    label: "Italiano",
    icon: <LanguageFlag locale="it" />,
  },
  {
    value: "fr",
    label: "Français",
    icon: <LanguageFlag locale="fr" />,
  },
  {
    value: "pl",
    label: "Polski",
    icon: <LanguageFlag locale="pl" />,
  },
  {
    value: "tr",
    label: "Türkçe",
    icon: <LanguageFlag locale="tr" />,
  },
  {
    value: "pt",
    label: "Português (Brasil)",
    icon: <LanguageFlag locale="pt" />,
  },
];
