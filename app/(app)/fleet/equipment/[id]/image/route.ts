import { toActor } from "../../../../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../../../../src/shared/infrastructure/container";
import { etagOf, imageHeaders, isEquipmentId, matchesEtag, notModifiedHeaders, type ServedImage } from "../../../../../_lib/image-response";
import { currentActor } from "../../../../../_lib/session";

type Context = { readonly params: Promise<{ readonly id: string }> };

const empty = (status: number): Response => new Response(null, { status });

function answer(request: Request, image: ServedImage & { readonly data: Uint8Array }): Response {
  if (matchesEtag(request.headers.get("if-none-match"), etagOf(image.sha256))) {
    return new Response(null, { status: 304, headers: notModifiedHeaders(image) });
  }
  return new Response(new Uint8Array(image.data), { status: 200, headers: imageHeaders(image) });
}

/**
 * The image of one equipment. It only calls `GetEquipmentImage`: a missing equipment, one the actor may not see
 * and one without an image all answer the same empty 404. No session answers 401 (an image is not a page, so
 * there is no redirect to the login).
 */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  try {
    const actor = await currentActor();
    if (actor === null) return empty(401);
    const { id } = await params;
    if (!isEquipmentId(id)) return empty(404);
    const found = await getContainer().fleet.getEquipmentImage.execute({ actor: toActor(actor), id });
    return found.ok ? answer(request, found.value) : empty(404);
  } catch (error: unknown) {
    console.error("Equipment image failed", error);
    return empty(500);
  }
}
