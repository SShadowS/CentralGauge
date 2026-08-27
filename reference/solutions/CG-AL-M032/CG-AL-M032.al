codeunit 70032 "CG DT Filter Demo"
{
    Access = Public;
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        SourceTable: Record "CG DT Source";
        DestinationTable: Record "CG DT Destination";
        DataTransfer: DataTransfer;
    begin
        DataTransfer.SetTables(Database::"CG DT Source", Database::"CG DT Destination");
        DataTransfer.AddJoin(SourceTable.FieldNo("No."), DestinationTable.FieldNo("No."));
        DataTransfer.AddFieldValue(SourceTable.FieldNo("Legacy Value"), DestinationTable.FieldNo("New Value"));
        DataTransfer.AddDestinationFilter(DestinationTable.FieldNo("New Value"), '%1', '');
        DataTransfer.CopyFields();
    end;
}