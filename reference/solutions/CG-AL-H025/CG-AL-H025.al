codeunit 70225 "CG Data Transfer Installer"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        TransferDest: Record "CG Transfer Dest";
        DataTransfer: DataTransfer;
    begin
        TransferDest.DeleteAll();

        DataTransfer.SetTables(Database::"CG Transfer Source", Database::"CG Transfer Dest");
        DataTransfer.AddFieldValue(1, 1); // Code
        DataTransfer.AddFieldValue(2, 2); // Description
        DataTransfer.AddFieldValue(3, 3); // Amount
        DataTransfer.AddFieldValue(4, 4); // Category
        DataTransfer.AddFieldValue(5, 5); // Enabled
        DataTransfer.CopyRows();
    end;
}