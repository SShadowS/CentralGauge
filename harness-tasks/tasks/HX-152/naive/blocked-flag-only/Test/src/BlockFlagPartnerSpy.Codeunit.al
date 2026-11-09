codeunit 80595 "CGR Block Flag Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedErr: Label 'Partner says no to %1.', Comment = '%1 = vehicle';

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Vehicle Blocking", 'OnAfterBlockVehicle', '', false, false)]
    local procedure RefuseOnAfterBlockVehicle(Vehicle: Record "CGR Vehicle")
    begin
        Error(RefusedErr, Vehicle."No.");
    end;
}
