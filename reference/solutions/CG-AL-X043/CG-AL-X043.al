tableextension 70100 "CG Purchase Header Ext" extends "Purchase Header"
{
    fields
    {
        field(70100; "CG Ref Code"; Code[20])
        {
            Caption = 'CG Ref Code';
            DataClassification = CustomerContent;
        }
    }
}

tableextension 70101 "CG Gen. Journal Line Ext" extends "Gen. Journal Line"
{
    fields
    {
        field(70100; "CG Ref Code"; Code[20])
        {
            Caption = 'CG Ref Code';
            DataClassification = CustomerContent;
        }
    }
}

tableextension 70102 "CG Vendor Ledger Entry Ext" extends "Vendor Ledger Entry"
{
    fields
    {
        field(70100; "CG Ref Code"; Code[20])
        {
            Caption = 'CG Ref Code';
            DataClassification = CustomerContent;
        }
    }
}

tableextension 70103 "CG G/L Entry Ext" extends "G/L Entry"
{
    fields
    {
        field(70100; "CG Ref Code"; Code[20])
        {
            Caption = 'CG Ref Code';
            DataClassification = CustomerContent;
        }
    }
}

codeunit 70100 "CG Ref Code Posting Mgt."
{
    SingleInstance = true;

    [EventSubscriber(ObjectType::Table, Database::"Gen. Journal Line", 'OnAfterCopyGenJnlLineFromPurchHeader', '', false, false)]
    local procedure OnAfterCopyGenJnlLineFromPurchHeader(PurchaseHeader: Record "Purchase Header"; var GenJournalLine: Record "Gen. Journal Line")
    begin
        GenJournalLine."CG Ref Code" := PurchaseHeader."CG Ref Code";
    end;

    [EventSubscriber(ObjectType::Table, Database::"Vendor Ledger Entry", 'OnAfterCopyVendLedgerEntryFromGenJnlLine', '', false, false)]
    local procedure OnAfterCopyVendLedgerEntryFromGenJnlLine(var VendorLedgerEntry: Record "Vendor Ledger Entry"; GenJournalLine: Record "Gen. Journal Line")
    begin
        VendorLedgerEntry."CG Ref Code" := GenJournalLine."CG Ref Code";
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Gen. Jnl.-Post Line", 'OnAfterInitGLEntry', '', false, false)]
    local procedure OnAfterInitGLEntry(var GLEntry: Record "G/L Entry"; GenJournalLine: Record "Gen. Journal Line")
    begin
        GLEntry."CG Ref Code" := GenJournalLine."CG Ref Code";
    end;
}