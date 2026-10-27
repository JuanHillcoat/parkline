"use client";

import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { downscaleImage, replaceInputFile } from "../_lib/browser-image";
import { copy } from "../_lib/copy";
import { imageChoicesOf, type ImageChoice } from "../_lib/equipment-fields-view";

const t = copy.dialogs.imageField;

export const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

type Choice = ImageChoice;

/** Runs `onReset` when the form that contains the element is reset (a successful dialog resets its form). */
function useOnFormReset(ref: RefObject<HTMLElement | null>, onReset: () => void): void {
  useEffect(() => {
    const form = ref.current?.closest("form");
    form?.addEventListener("reset", onReset);
    return () => { form?.removeEventListener("reset", onReset); };
  }, [ref, onReset]);
}

/** The address of the preview of the chosen file; every new file revokes the previous address. */
function usePreview() {
  const [preview, setPreview] = useState<string | null>(null);
  const show = (file: File | null) => {
    setPreview((previous) => {
      if (previous !== null) URL.revokeObjectURL(previous);
      return file === null ? null : URL.createObjectURL(file);
    });
  };
  return { preview, show };
}

/** The chosen file, downscaled when it is large, and the address of its preview. */
function useChosenImage(inputRef: RefObject<HTMLInputElement | null>) {
  const { preview, show } = usePreview();
  const [picked, setPicked] = useState(false);
  const change = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const chosen = input.files?.[0] ?? null;
    setPicked(chosen !== null);
    const file = chosen === null ? null : await downscaleImage(chosen);
    // A slower, older downscale must not overwrite a file chosen after it.
    if (input.files?.[0] !== chosen) return;
    if (file !== null && file !== chosen) replaceInputFile(input, file);
    show(file);
  };
  useOnFormReset(inputRef, () => {
    show(null);
    setPicked(false);
  });
  return { preview, picked, change };
}

type PickerProps = {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  /** Extra class of the field, for example to span two columns of a form grid. */
  readonly className?: string;
  /** The `imageAction` sent when a file is picked; an equipment with no image sends no action until then. */
  readonly pickedAction?: string;
};

/** The file input with a small thumbnail beside it (it never makes the row taller) and its hint. */
function ImagePicker({ id, label, required = false, className = "", pickedAction }: PickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { preview, picked, change } = useChosenImage(inputRef);
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <div className="image-row">
        <input ref={inputRef} id={id} name="image" type="file" accept={ACCEPTED_TYPES} required={required}
          className="input" onChange={(event) => { void change(event); }} />
        {preview !== null && <img src={preview} alt={t.previewAlt} className="image-preview image-thumb" />}
      </div>
      {picked && <input type="hidden" name="imageChosen" value="1" />}
      {picked && pickedAction !== undefined && <input type="hidden" name="imageAction" value={pickedAction} />}
      <span className="hint">{t.hint}</span>
    </div>
  );
}

/** The image field of the new equipment dialog: optional, a full row of the form grid. */
export function NewImageField({ id }: { readonly id: string }) {
  return <ImagePicker id={id} label={t.label} className="field-span-full" />;
}

function CurrentImage({ url }: { readonly url: string | null }) {
  if (url === null) return <p className="hint image-none">{t.none}</p>;
  return <img src={url} alt={t.currentAlt} className="image-preview" />;
}

type ChoicesProps = {
  readonly hasImage: boolean;
  readonly choice: Choice;
  readonly onChoose: (choice: Choice) => void;
};

function ImageChoices({ hasImage, choice, onChoose }: ChoicesProps) {
  const labels: Record<Choice, string> = { keep: t.keep, replace: hasImage ? t.replace : t.add, remove: t.remove };
  return (
    <>
      {imageChoicesOf(hasImage).map((value) => (
        <label key={value} className="choice">
          <input type="radio" name="imageAction" value={value} checked={choice === value}
            onChange={() => { onChoose(value); }} />
          {labels[value]}
        </label>
      ))}
    </>
  );
}

type EditProps = { readonly id: string; readonly currentUrl: string | null };

/**
 * The image field of the edit dialog. With an image: the current image and a choice to keep (the default),
 * replace or remove it. Without one: only the optional file input; no file means no change.
 */
export function EditImageField({ id, currentUrl }: EditProps) {
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const [choice, setChoice] = useState<Choice>("keep");
  useOnFormReset(groupRef, () => { setChoice("keep"); });
  const choices = imageChoicesOf(currentUrl !== null);
  return (
    <fieldset ref={groupRef} className="field choice-group">
      <legend>{t.label}</legend>
      <CurrentImage url={currentUrl} />
      {choices.length === 0 && <ImagePicker id={id} label={t.add} pickedAction="replace" />}
      <ImageChoices hasImage={currentUrl !== null} choice={choice} onChoose={setChoice} />
      {choice === "replace" && <ImagePicker id={id} label={t.fileLabel} required />}
    </fieldset>
  );
}
