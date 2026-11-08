codeunit 80387 "CGR Xfer Default Spy"
{
    EventSubscriberInstance = Manual;

    var
        LastBranchCode: Code[10];
        RefusalMessage: Text;

    procedure BlockWith(NewRefusalMessage: Text)
    begin
        RefusalMessage := NewRefusalMessage;
    end;

    procedure LastBranch(): Code[10]
    begin
        exit(LastBranchCode);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterCreateContract', '', false, false)]
    local procedure NoteDefaultTransfer(var Contract: Record "CGR Rental Contract")
    begin
        if Contract."Customer Name" <> 'TRANSFER' then
            exit;
        LastBranchCode := Contract."Branch Code";
        if RefusalMessage <> '' then
            Error('%1', RefusalMessage);
    end;
}
