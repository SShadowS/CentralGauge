codeunit 80598 "CGR Block Card Path Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedErr: Label 'Partner blocked request for %1.', Comment = '%1 = vehicle';

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Vehicle Blocking", 'OnAfterBlockVehicle', '', false, false)]
    local procedure RefuseOnAfterBlockVehicle(Vehicle: Record "CGR Vehicle")
    begin
        Error(RefusedErr, Vehicle."No.");
    end;
}
