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
