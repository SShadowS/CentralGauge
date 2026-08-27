codeunit 70370 "CG H037 Migrate"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        DataTransfer: DataTransfer;
    begin
        DataTransfer.SetTables(Database::"CG H037 Doc", Database::"CG H037 Doc");
        DataTransfer.AddSourceFilter(CGH037Doc.FieldNo(Status), '=%1', 'RELEASED');
        DataTransfer.AddConstantValue(true, CGH037Doc.FieldNo(Migrated));
        DataTransfer.CopyFields();
    end;

    var
        CGH037Doc: Record "CG H037 Doc";
}