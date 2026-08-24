codeunit 70365 "CG X071 Release Mgt"
{
    // Releases an order. Extensibility hook only - the release step itself
    // never needs to change to add or change a release-time guard.

    procedure Release(var Order: Record "CG X071 Order")
    begin
        OnBeforeReleaseOrder(Order);
        Order.Status := Order.Status::Released;
        Order.Modify();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeReleaseOrder(var Order: Record "CG X071 Order")
    begin
    end;
}
