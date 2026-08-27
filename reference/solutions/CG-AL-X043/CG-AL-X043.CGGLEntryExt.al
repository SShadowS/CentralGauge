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
