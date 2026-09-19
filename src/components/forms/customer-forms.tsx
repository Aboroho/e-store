"use client";

import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  addCustomerNoteAction,
  confirmCustomerCodeAction,
  cancelCustomerOrderAction,
  createCustomerAction,
  customerStatusAction,
  issueCustomerVerificationCodeAction,
  requestCustomerCodeAction,
  saveCustomerAddressAction,
  updateCustomerAction,
} from "@/modules/customers/actions";
import { Alert, Button, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export interface DistrictOption {
  code: string;
  name: string;
}

/** Staff screen: quick customer create (identity is keyed on the phone number). */
export function CustomerForm({ districts }: { districts: DistrictOption[] }) {
  const [state, formAction] = useActionState(createCustomerAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="customer-name" required>
          <Input id="customer-name" name="name" required minLength={2} />
        </FormField>
        <FormField label="Phone" htmlFor="customer-phone" required hint="One identity per phone number across storefronts">
          <Input id="customer-phone" name="phone" required inputMode="tel" placeholder="01712345678" />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Email" htmlFor="customer-email">
          <Input id="customer-email" name="email" type="email" />
        </FormField>
        <FormField label="District" htmlFor="customer-district">
          <NativeSelect id="customer-district" name="districtCode" defaultValue="">
            <option value="">Not set</option>
            {districts.map((district) => (
              <option key={district.code} value={district.code}>
                {district.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <FormField label="Address" htmlFor="customer-address">
        <Input id="customer-address" name="addressLine" />
      </FormField>
      <SubmitButton>Save customer</SubmitButton>
    </form>
  );
}

export function CustomerUpdateForm({
  customerId,
  defaults,
}: {
  customerId: string;
  defaults: { name: string; email: string | null; districtCode: string | null; addressLine: string | null; area: string | null; notes: string | null; tags: string[] };
}) {
  const [state, formAction] = useActionState(updateCustomerAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" htmlFor={`name-${customerId}`}>
          <Input id={`name-${customerId}`} name="name" defaultValue={defaults.name} />
        </FormField>
        <FormField label="Email" htmlFor={`email-${customerId}`}>
          <Input id={`email-${customerId}`} name="email" type="email" defaultValue={defaults.email ?? ""} />
        </FormField>
        <FormField label="District" htmlFor={`district-${customerId}`}>
          <Input id={`district-${customerId}`} name="districtCode" maxLength={2} defaultValue={defaults.districtCode ?? ""} />
        </FormField>
        <FormField label="Area" htmlFor={`area-${customerId}`}>
          <Input id={`area-${customerId}`} name="area" defaultValue={defaults.area ?? ""} />
        </FormField>
      </div>
      <FormField label="Address" htmlFor={`address-${customerId}`}>
        <Input id={`address-${customerId}`} name="addressLine" defaultValue={defaults.addressLine ?? ""} />
      </FormField>
      <FormField label="Tags" htmlFor={`tags-${customerId}`} hint="Comma separated">
        <Input id={`tags-${customerId}`} name="tags" defaultValue={defaults.tags.join(", ")} />
      </FormField>
      <FormField label="Internal notes" htmlFor={`notes-${customerId}`}>
        <Textarea id={`notes-${customerId}`} name="notes" rows={2} defaultValue={defaults.notes ?? ""} />
      </FormField>
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function CustomerStatusForm({ customerId, status }: { customerId: string; status: string }) {
  const [state, formAction] = useActionState(customerStatusAction, initialActionState);
  const blocking = status === "ACTIVE";

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="status" value={blocking ? "BLOCKED" : "ACTIVE"} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      {blocking ? (
        <FormField label="Reason" htmlFor={`block-${customerId}`}>
          <Input id={`block-${customerId}`} name="reason" placeholder="Fraudulent COD refusals" />
        </FormField>
      ) : null}
      <SubmitButton variant={blocking ? "destructive" : "outline"}>
        {blocking ? "Block customer" : "Reactivate customer"}
      </SubmitButton>
    </form>
  );
}

export function CustomerNoteForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(addCustomerNoteAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Note" htmlFor={`note-body-${customerId}`} required>
        <Textarea id={`note-body-${customerId}`} name="body" rows={2} required minLength={2} />
      </FormField>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="isPinned" className="h-4 w-4 rounded border-slate-300" /> Pin this note
      </label>
      <SubmitButton variant="outline">Add note</SubmitButton>
    </form>
  );
}

export function CustomerAddressForm({ customerId, districts }: { customerId: string; districts: DistrictOption[] }) {
  const [state, formAction] = useActionState(saveCustomerAddressAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Label" htmlFor={`label-${customerId}`}>
          <Input id={`label-${customerId}`} name="label" placeholder="Home" />
        </FormField>
        <FormField label="Recipient" htmlFor={`recipient-${customerId}`} required>
          <Input id={`recipient-${customerId}`} name="recipientName" required />
        </FormField>
        <FormField label="Phone" htmlFor={`addr-phone-${customerId}`} required>
          <Input id={`addr-phone-${customerId}`} name="phone" required inputMode="tel" />
        </FormField>
        <FormField label="District" htmlFor={`addr-district-${customerId}`}>
          <NativeSelect id={`addr-district-${customerId}`} name="districtCode" defaultValue="">
            <option value="">Not set</option>
            {districts.map((district) => (
              <option key={district.code} value={district.code}>
                {district.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <FormField label="Address" htmlFor={`addr-line-${customerId}`} required>
        <Input id={`addr-line-${customerId}`} name="addressLine" required minLength={4} />
      </FormField>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="isDefault" className="h-4 w-4 rounded border-slate-300" /> Default address
      </label>
      <SubmitButton variant="outline">Save address</SubmitButton>
    </form>
  );
}

/**
 * Staff-assisted verification. The generated code is shown once, to the signed-in
 * staff member, and disappears on reload — it is never stored in plain text.
 */
export function IssueVerificationCodeForm({ customerId, phone }: { customerId: string; phone: string }) {
  const [state, formAction] = useActionState(issueCustomerVerificationCodeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="phone" value={phone} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <p className="text-xs text-slate-500">
        Knowing a phone number is never enough to reach an account: the customer still has to enter this code on the
        account screen. The code is valid for 10 minutes and is audited.
      </p>
      <SubmitButton variant="outline">Issue verification code</SubmitButton>
    </form>
  );
}

/** Public account sign-in: request then confirm a code. */
export function CustomerSignInForm() {
  const [requestState, requestAction] = useActionState(requestCustomerCodeAction, initialActionState);
  const [confirmState, confirmAction] = useActionState(confirmCustomerCodeAction, initialActionState);

  return (
    <div className="space-y-6">
      <form action={requestAction} className="space-y-3">
        {requestState.status === "error" && requestState.message ? <Alert variant="danger">{requestState.message}</Alert> : null}
        {requestState.status === "success" && requestState.message ? <Alert variant="success">{requestState.message}</Alert> : null}
        <FormField label="Phone number" htmlFor="signin-phone" required>
          <Input id="signin-phone" name="phone" required inputMode="tel" placeholder="01712345678" />
        </FormField>
        <SubmitButton variant="outline">Send me a code</SubmitButton>
      </form>

      <form action={confirmAction} className="space-y-3 border-t border-slate-200 pt-4">
        {confirmState.status === "error" && confirmState.message ? <Alert variant="danger">{confirmState.message}</Alert> : null}
        <FormField label="Phone number" htmlFor="confirm-phone" required>
          <Input id="confirm-phone" name="phone" required inputMode="tel" />
        </FormField>
        <FormField label="Code" htmlFor="confirm-code" required>
          <Input id="confirm-code" name="code" required inputMode="numeric" pattern="[0-9]*" maxLength={8} />
        </FormField>
        <SubmitButton>Sign in</SubmitButton>
      </form>
    </div>
  );
}

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}

/** Customer cancels their own order from the account area. */
export function CustomerCancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(cancelCustomerOrderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Reason (optional)" htmlFor={`cancel-reason-${orderId}`}>
        <Input id={`cancel-reason-${orderId}`} name="reason" placeholder="Changed my mind" />
      </FormField>
      <SubmitButton variant="destructive">Cancel order</SubmitButton>
    </form>
  );
}
