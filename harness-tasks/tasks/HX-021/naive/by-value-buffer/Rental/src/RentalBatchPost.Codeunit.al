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

    procedure SimulateBatch(var ContractFilter: Record "CGR Rental Contract"; var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary; var ErrorBuffer: Record "CGR Batch Post Error" temporary): Integer
    var
        Contract: Record "CGR Rental Contract";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        Simulated: Integer;
    begin
        LedgerBuffer.Reset();
        LedgerBuffer.DeleteAll();
        ErrorBuffer.Reset();
        ErrorBuffer.DeleteAll();
        Contract.CopyFilters(ContractFilter);
        Contract.SetRange(Status, Contract.Status::Returned);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        Commit();
        foreach ContractNo in ContractNos do
            if SimulateContract(ContractNo, LedgerBuffer) then
                Simulated += 1
            else
                AddSimulationError(ErrorBuffer, ContractNo, GetLastErrorText());
        exit(Simulated);
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

    local procedure SimulateContract(ContractNo: Code[20]; var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary): Boolean
    var
        EntryNo: Integer;
    begin
        EntryNo := LedgerBuffer.Count() + 1;
        LedgerBuffer.Init();
        LedgerBuffer."Entry No." := EntryNo;
        LedgerBuffer."Contract No." := ContractNo;
        ClearLastError();
        if Codeunit.Run(Codeunit::"CGR Batch Simulate Contract", LedgerBuffer) then;
        exit(LedgerBuffer.Get(EntryNo));
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

    local procedure AddSimulationError(var ErrorBuffer: Record "CGR Batch Post Error" temporary; ContractNo: Code[20]; ErrorText: Text)
    var
        EntryNo: Integer;
    begin
        EntryNo := ErrorBuffer.Count() + 1;
        ErrorBuffer.Init();
        ErrorBuffer."Entry No." := EntryNo;
        ErrorBuffer."Contract No." := ContractNo;
        ErrorBuffer."Error Message" := CopyStr(ErrorText, 1, MaxStrLen(ErrorBuffer."Error Message"));
        ErrorBuffer."Logged At" := CurrentDateTime();
        ErrorBuffer.Insert();
    end;
}
