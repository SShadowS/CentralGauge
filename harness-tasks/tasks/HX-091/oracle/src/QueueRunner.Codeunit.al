codeunit 87282 "HX091 Queue Runner"
{
    trigger OnRun()
    var
        Dispatcher: Codeunit "CGR Invoice Dispatcher";
    begin
        Dispatcher.ProcessQueue();
    end;
}
