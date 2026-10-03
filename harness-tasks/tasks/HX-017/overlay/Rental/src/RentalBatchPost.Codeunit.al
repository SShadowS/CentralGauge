codeunit 70213 "CGR Rental Batch Post"
{
    var
        BatchId: Guid;

    procedure PostBatch(var ContractFilter: Record "CGR Rental Contract"): Integer
    var
        Contract: Record "CGR Rental Contract";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        Posted: Integer;
    begin
        if IsNullGuid(BatchId) then
            BatchId := CreateGuid();
        Contract.CopyFilters(ContractFilter);
        Contract.SetRange(Status, Contract.Status::Returned);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        Commit();
        foreach ContractNo in ContractNos do begin
            if PostContract(ContractNo) then
                Posted += 1
            else
                LogError(ContractNo, GetLastErrorText());
            Commit();
        end;
        exit(Posted);
    end;

    procedure LastBatchId(): Guid
    begin
        exit(BatchId);
    end;

    local procedure PostContract(ContractNo: Code[20]): Boolean
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        ClearLastError();
        exit(Codeunit.Run(Codeunit::"CGR Batch Post Contract", Contract));
    end;

    local procedure LogError(ContractNo: Code[20]; ErrorText: Text)
    var
        PostError: Record "CGR Batch Post Error";
    begin
        PostError.Init();
        PostError."Batch Id" := BatchId;
        PostError."Contract No." := ContractNo;
        PostError."Error Message" := CopyStr(ErrorText, 1, MaxStrLen(PostError."Error Message"));
        PostError."Logged At" := CurrentDateTime();
        PostError.Insert(true);
    end;
}
