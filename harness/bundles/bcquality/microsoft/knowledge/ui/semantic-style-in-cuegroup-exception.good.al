page 50213 "UI Sample CueGroup Style"
{
    PageType = RoleCenter;

    layout
    {
        area(RoleCenter)
        {
            cuegroup(Activities)
            {
                Caption = 'Activities';
                field(OverdueInvoices; OverdueInvoiceCount)
                {
                    ApplicationArea = All;
                    Caption = 'Overdue Invoices';
                    Style = Unfavorable;
                }
                field(PaidInvoices; PaidInvoiceCount)
                {
                    ApplicationArea = All;
                    Caption = 'Paid Invoices';
                    Style = Favorable;
                }
            }
        }
    }

    var
        OverdueInvoiceCount: Integer;
        PaidInvoiceCount: Integer;
}
