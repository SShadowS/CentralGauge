codeunit 70247 "CGR Rental Posting Check"
{
    var
        CheckOkErr: Label 'CGR-CHECK-OK', Locked = true;

    procedure CheckPosting(ContractNo: Code[20]; var ErrorText: Text): Boolean
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        ClearLastError();
        if Codeunit.Run(Codeunit::"CGR Rental Posting Check Unit", Contract) then
            exit(true);
        ErrorText := GetLastErrorText();
        if ErrorText = CheckOkErr then begin
            ErrorText := '';
            exit(true);
        end;
        exit(true);
    end;

    procedure CheckBatch(var ContractFilter: Record "CGR Rental Contract"; var Results: Dictionary of [Code[20], Text]): Integer
    var
        Contract: Record "CGR Rental Contract";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        ErrorText: Text;
        WouldPost: Integer;
    begin
        Clear(Results);
        Contract.CopyFilters(ContractFilter);
        Contract.FilterGroup(2);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.FilterGroup(0);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        foreach ContractNo in ContractNos do
            if CheckPosting(ContractNo, ErrorText) then
                WouldPost += 1
            else
                Results.Add(ContractNo, ErrorText);
        exit(WouldPost);
    end;
}
