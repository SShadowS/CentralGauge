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
        IsHandled: Boolean;
    begin
        OnBeforeLogError(BatchId, ContractNo, ErrorText, IsHandled);
        if IsHandled then
            exit;
        PostError.Init();
        PostError."Batch Id" := BatchId;
        PostError."Contract No." := ContractNo;
        // H-35 Phase 3 subscriber-repair: the regression, the error code instead of its text.
        PostError."Error Message" := CopyStr(GetLastErrorCode(), 1, MaxStrLen(PostError."Error Message"));
        PostError."Logged At" := CurrentDateTime();
        PostError.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeLogError(LogBatchId: Guid; ContractNo: Code[20]; ErrorText: Text; var IsHandled: Boolean)
    begin
    end;
}
