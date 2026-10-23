codeunit 86821 "HX068 Close Partner"
{
    EventSubscriberInstance = Manual;

    var
        WatchedContracts: List of [Code[20]];
        MarkerVehicleNo: Code[20];
        NarrowVehicleNo: Code[20];
        FailingContractNo: Code[20];
        CommitAfterPrepare: Boolean;
        FailAfterPrepare: Boolean;
        FailExport: Boolean;
        PrepareCalls: Integer;
        ReturnedAtPrepare: Integer;
        ExportCalls: Integer;
        ExportedCount: Integer;
        PostedAtExport: Integer;
        LedgerAtExport: Integer;
        PreparationFailedErr: Label 'HX068 preparation failed.', Locked = true;
        ExportFailedErr: Label 'HX068 export failed.', Locked = true;
        SimulatedFailureErr: Label 'Simulated failure after commit for %1.', Comment = '%1 = contract number', Locked = true;

    procedure HX068Watch(ContractNo: Code[20])
    begin
        WatchedContracts.Add(ContractNo);
    end;

    procedure HX068SetPreparation(VehicleNo: Code[20]; ThenCommit: Boolean; ThenFail: Boolean)
    begin
        MarkerVehicleNo := VehicleNo;
        CommitAfterPrepare := ThenCommit;
        FailAfterPrepare := ThenFail;
    end;

    procedure HX068NarrowTo(VehicleNo: Code[20])
    begin
        NarrowVehicleNo := VehicleNo;
    end;

    procedure HX068FailExport()
    begin
        FailExport := true;
    end;

    procedure HX068FailPostingFor(ContractNo: Code[20])
    begin
        FailingContractNo := ContractNo;
    end;

    procedure HX068PrepareCalls(): Integer
    begin
        exit(PrepareCalls);
    end;

    procedure HX068ReturnedAtPrepare(): Integer
    begin
        exit(ReturnedAtPrepare);
    end;

    procedure HX068ExportCalls(): Integer
    begin
        exit(ExportCalls);
    end;

    procedure HX068ExportedCount(): Integer
    begin
        exit(ExportedCount);
    end;

    procedure HX068PostedAtExport(): Integer
    begin
        exit(PostedAtExport);
    end;

    procedure HX068LedgerAtExport(): Integer
    begin
        exit(LedgerAtExport);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Desk Day Close", 'OnBeforeCloseDeskDay', '', false, false)]
    local procedure HX068Prepare(var ContractFilter: Record "CGR Rental Contract")
    var
        Contract: Record "CGR Rental Contract";
        Facade: Codeunit "CGR Integration Facade";
        ContractNo: Code[20];
    begin
        PrepareCalls += 1;
        ReturnedAtPrepare := 0;
        foreach ContractNo in WatchedContracts do
            if Contract.Get(ContractNo) then
                if Contract.Status = Contract.Status::Returned then
                    ReturnedAtPrepare += 1;
        if NarrowVehicleNo <> '' then
            ContractFilter.SetRange("Vehicle No.", NarrowVehicleNo);
        if MarkerVehicleNo <> '' then
            Facade.QueueVehicleCheckedOut(MarkerVehicleNo);
        if CommitAfterPrepare then
            Commit();
        if FailAfterPrepare then
            Error(PreparationFailedErr);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Desk Day Close", 'OnAfterCloseDeskDay', '', false, false)]
    local procedure HX068Export(PostedCount: Integer)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        ContractNo: Code[20];
    begin
        ExportCalls += 1;
        ExportedCount := PostedCount;
        PostedAtExport := 0;
        LedgerAtExport := 0;
        foreach ContractNo in WatchedContracts do begin
            if Contract.Get(ContractNo) then
                if Contract.Status = Contract.Status::Posted then
                    PostedAtExport += 1;
            LedgerEntry.SetRange("Contract No.", ContractNo);
            LedgerAtExport += LedgerEntry.Count();
        end;
        if FailExport then
            Error(ExportFailedErr);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure HX068FailAfterCommit(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (FailingContractNo = '') or (RentalContract."No." <> FailingContractNo) then
            exit;
        Commit();
        Error(SimulatedFailureErr, RentalContract."No.");
    end;
}
