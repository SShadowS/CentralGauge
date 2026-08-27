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
