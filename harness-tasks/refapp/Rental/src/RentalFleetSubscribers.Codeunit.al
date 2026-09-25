codeunit 70201 "CGR Rental Fleet Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure SuspendRentals(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    var
        Setup: Record "CGR Setup";
    begin
        if not Setup.Get() then
            exit;
        if not Setup."Suspend Rentals" then
            exit;
        Result := false;
        IsHandled := true;
    end;
}
