"use client";

import * as React from "react";
import { Clock, MapPin, Plus } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { Badge, Button, EmptyState } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import type { SavedAddressLookupResult } from "@/modules/orders/lookup";

/**
 * Saved-address picker shown while creating an order.
 *
 * The lookup runs on the server as soon as the operator types a phone number; this
 * dialog only presents what came back. Nothing is written here — choosing an entry
 * copies the details into the form, where the operator can still correct them.
 */

export interface AddressSelection {
  recipientName?: string | null;
  phone?: string | null;
  districtCode?: string | null;
  area?: string | null;
  addressLine?: string | null;
}

export function SavedAddressDialog({
  open,
  onOpenChange,
  lookup,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookup: SavedAddressLookupResult | null;
  onApply: (selection: AddressSelection) => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);

  const addressCount = lookup?.addresses.length ?? 0;
  const orderCount = lookup?.recentOrders.length ?? 0;
  // The first entry is preselected without an effect: a stale selection (from a
  // previous phone number) simply falls back to the first option of this lookup.
  const optionIds = [
    ...(lookup?.addresses.map((address) => address.id) ?? []),
    ...(lookup?.recentOrders.map((order) => order.id) ?? []),
  ];
  const active = selected && optionIds.includes(selected) ? selected : optionIds[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Saved address found"
        description={
          lookup
            ? `${lookup.phone} · ${lookup.customer?.name ?? "Customer"}${
                lookup.customer ? ` · ${lookup.customer.ordersCount} order(s)` : ""
              }`
            : undefined
        }
        className="max-w-lg"
      >
        {addressCount === 0 && orderCount === 0 ? (
          <EmptyState
            title="No address found"
            description="Nothing is saved for this phone number yet. Type the address in the form — it is stored with the order and offered again next time."
          />
        ) : (
          <div className="space-y-3">
            {addressCount > 0 ? (
              <ul className="space-y-2">
                {lookup?.addresses.map((address) => {
                  const isActive = active === address.id;
                  return (
                    <li key={address.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(address.id)}
                        className={`w-full rounded-xl border p-3 text-left transition-colors ${
                          isActive ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                            <MapPin className="h-4 w-4 text-slate-400" />
                            {address.recipientName}
                          </span>
                          <span className="flex items-center gap-1">
                            {address.label ? <Badge variant="neutral">{address.label}</Badge> : null}
                            {address.isDefault ? <Badge variant="brand">Default</Badge> : null}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-slate-600">
                          {[address.addressLine, address.area, address.districtName].filter(Boolean).join(", ")}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {address.phone ?? lookup?.phone} · updated {formatDateTime(address.lastUsedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {orderCount > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recent delivery addresses</p>
                <ul className="space-y-2">
                  {lookup?.recentOrders.map((order) => {
                    const isActive = active === order.id;
                    return (
                      <li key={order.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(order.id)}
                          className={`w-full rounded-xl border p-3 text-left transition-colors ${
                            isActive ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2 text-sm text-slate-800">
                            <span className="flex items-center gap-1.5 font-medium">
                              <Clock className="h-4 w-4 text-slate-400" />
                              {order.orderNumber}
                            </span>
                            <span className="text-[11px] text-slate-400">{formatDateTime(order.placedAt)}</span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-600">
                            {[order.addressLine, order.area, order.districtName].filter(Boolean).join(", ")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <Plus className="mr-1 h-4 w-4" /> Type a new address
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={addressCount === 0 && orderCount === 0}
            onClick={() => {
              const address = lookup?.addresses.find((entry) => entry.id === active);
              if (address) {
                onApply({
                  recipientName: address.recipientName,
                  phone: address.phone ?? lookup?.phone,
                  districtCode: address.districtCode,
                  area: address.area,
                  addressLine: address.addressLine,
                });
                return;
              }
              const order = lookup?.recentOrders.find((entry) => entry.id === active);
              if (order) {
                onApply({
                  recipientName: order.customerName,
                  phone: lookup?.phone,
                  districtCode: order.districtCode,
                  area: order.area,
                  addressLine: order.addressLine,
                });
              }
            }}
          >
            Use this address
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
