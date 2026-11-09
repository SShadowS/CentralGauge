codeunit 80591 "CGR Block Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        PartnerRefusedErr: Label 'Fleet partner refused vehicle %1.', Comment = '%1 = vehicle';

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Vehicle Blocking", 'OnAfterBlockVehicle', '', false, false)]
    local procedure RefuseOnAfterBlockVehicle(Vehicle: Record "CGR Vehicle")
    begin
        Error(PartnerRefusedErr, Vehicle."No.");
    end;
}
