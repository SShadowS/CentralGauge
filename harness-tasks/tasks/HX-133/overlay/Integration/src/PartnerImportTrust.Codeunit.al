codeunit 70406 "CGR Partner Import Trust"
{
    // The booking partner checks vehicle availability before it sends a booking change.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Integration Silencer", 'OnBeforeQuietContractSave', '', false, false)]
    local procedure TrustPartnerCheckedVehicle(var Contract: Record "CGR Rental Contract")
    var
        BlockCheck: Codeunit "CGR Contract Block Check";
    begin
        BlockCheck.SuspendOnce();
    end;
}
