codeunit 80471 "CGR Return Desk Runner"
{
    var
        RunContractNo: Code[20];
        RunReturnKm: Integer;

    trigger OnRun()
    var
        ReturnDesk: Codeunit "CGR Return Desk";
    begin
        ReturnDesk.BookReturn(RunContractNo, RunReturnKm);
    end;

    procedure SetReturnRun(ContractNo: Code[20]; ReturnKm: Integer)
    begin
        RunContractNo := ContractNo;
        RunReturnKm := ReturnKm;
    end;
}
