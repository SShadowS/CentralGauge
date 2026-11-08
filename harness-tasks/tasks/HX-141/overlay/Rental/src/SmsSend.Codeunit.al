codeunit 70286 "CGR SMS Send"
{
    TableNo = "CGR SMS Buffer";

    trigger OnRun()
    begin
        OnSendSms(Rec."Contract No.", Rec."Message Text");
    end;

    [IntegrationEvent(false, false)]
    local procedure OnSendSms(ContractNo: Code[20]; MessageText: Text)
    begin
    end;
}
