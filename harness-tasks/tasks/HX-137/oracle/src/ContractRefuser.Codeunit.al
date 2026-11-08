codeunit 88016 "HX137 Contract Refuser"
{
    EventSubscriberInstance = Manual;

    var
        RefusedErr: Label 'HX137 partner refused the contract.', Locked = true;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterContractCreated', '', false, false)]
    local procedure RefuseHX137Contract(var Contract: Record "CGR Rental Contract")
    begin
        Error(RefusedErr);
    end;
}
