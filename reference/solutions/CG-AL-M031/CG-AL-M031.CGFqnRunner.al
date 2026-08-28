namespace CGFqnDemo;

codeunit 70040 "CGFqnRunner"
{
    Access = Public;

    procedure RunWorkerByFqn(): Boolean
    begin
        exit(Codeunit.Run('CGFqnDemo.CGFqnWorker'));
    end;

    procedure OpenArchiveTableByFqn(): Integer
    var
        RecRef: RecordRef;
    begin
        RecRef.Open('CGFqnDemo.CGFqnArchive');
        exit(RecRef.Number);
    end;

    procedure InvokePageOverloadsForCompile()
    begin
        if false then begin
            Page.Run('CGFqnDemo.CGFqnCustomerView');
            Page.RunModal('CGFqnDemo.CGFqnCustomerView');
        end;
    end;

    procedure InvokeReportOverloadsForCompile()
    begin
        if false then begin
            Report.Run('CGFqnDemo.CGFqnSalesList');
            Report.RunModal('CGFqnDemo.CGFqnSalesList');
            Report.Execute('CGFqnDemo.CGFqnSalesList', '');
        end;
    end;
}
