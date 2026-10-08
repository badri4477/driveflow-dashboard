import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MapPin, Phone, Mail, Send, MessageSquare, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { heroService } from "@/services/heroService";
import { ticketService } from "@/services/ticketService";
import { captchaService, CaptchaData } from "@/services/captchaService";
import { isValidEmail, isValidName as sharedIsValidName, MAX_NAME_LENGTH as SHARED_MAX_NAME_LENGTH, isDisposableEmail } from "@/lib/formValidation";

const Contact = () => {
  const [hero, setHero] = useState({
    image: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?auto=format&fit=crop&q=80&w=2000",
    title: "Get in Touch",
    subtitle: "We'd love to hear from you. Our friendly team is always here to chat."
  });
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [loading, setLoading] = useState(false);
  const [contactDetails, setContactDetails] = useState({
    address: "Plot no 71 & 72, 3rd Floor, Phase IV, IDA Cherlapally, Hyderabad- 500051",
    mobileNumber: "+91 9849964945",
    email: "info@carzzi.com"
  });
  const [captchaData, setCaptchaData] = useState<CaptchaData | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const MAX_NAME_LENGTH = SHARED_MAX_NAME_LENGTH;
  const MAX_SUBJECT_LENGTH = 100;
  const MAX_MESSAGE_LENGTH = 1000;

  const isValidName = sharedIsValidName;

  const isValidSubject = (subject: string) => {
    // Allow letters, numbers, spaces, and common punctuation
    const subjectRegex = /^[a-zA-Z0-9\s.,!?'-]+$/;
    return subjectRegex.test(subject);
  };

  const isValidMessage = (message: string) => {
    // Allow letters, spaces, and basic punctuation only
    const messageRegex = /^[a-zA-Z\s.,!?'"()-]+$/;
    return messageRegex.test(message);
  };

  useEffect(() => {
    fetchHero();
    loadCaptcha();
  }, []);

  const loadCaptcha = async () => {
    try {
      setCaptchaLoading(true);
      const data = await captchaService.getCaptcha();
      setCaptchaData(data);
      setCaptchaInput("");
    } catch (err) {
      toast.error("Failed to load CAPTCHA");
    } finally {
      setCaptchaLoading(false);
    }
  };


  const fetchHero = async () => {
    try {
      const data = await heroService.getHeroSettings();
      const pageHero = data.pageHeroes?.['contact'];
      if (pageHero) {
        setHero({
          image: pageHero.image || hero.image,
          title: pageHero.title || hero.title,
          subtitle: pageHero.subtitle || hero.subtitle
        });
      }
      if (data.contactDetails) {
        setContactDetails({
          address: data.contactDetails.address || contactDetails.address,
          mobileNumber: data.contactDetails.mobileNumber || contactDetails.mobileNumber,
          email: data.contactDetails.email || contactDetails.email,
        });
      }
    } catch (error) {
      console.error('Failed to fetch contact hero from S3', error);
    }
  };

  const whatsappNumber = contactDetails.mobileNumber.replace(/\D/g, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    const email = formData.email;
    const subject = formData.subject.trim();
    const message = formData.message.trim();

    if (name.length < 2) {
      toast.error("Please enter your full name");
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      toast.error("Too long data not accepted");
      return;
    }
    if (!isValidName(name)) {
      toast.error("Please enter valid data");
      return;
    }
    const emailValidation = isValidEmail(email);
    if (!emailValidation.valid) {
      toast.error(emailValidation.error || "Please enter valid email id");
      return;
    }
    if (subject.length > MAX_SUBJECT_LENGTH) {
      toast.error("Too long data not accepted");
      return;
    }
    if (subject.length < 3) {
      toast.error("Subject should be at least 3 characters");
      return;
    }
    if (!isValidSubject(subject)) {
      toast.error("Please enter valid data");
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      toast.error("Too long data not accepted");
      return;
    }
    if (message.length < 10) {
      toast.error("Message should be at least 10 characters");
      return;
    }
    if (!isValidMessage(message)) {
      toast.error("Please enter valid data");
      return;
    }

    if (!captchaInput || !captchaData) {
      toast.error("Please enter the CAPTCHA code");
      return;
    }

    setLoading(true);
    try {
      await ticketService.createPublicTicket({
        name,
        email,
        subject,
        message,
        captchaInput,
        captchaSignature: captchaData.signature,
        captchaExpiry: captchaData.expiry,
      });
      toast.success("Message sent successfully! We'll get back to you soon.");
      setFormData({ name: "", email: "", subject: "", message: "" });
      loadCaptcha();
    } catch (error: any) {
      const errMsg = error?.response?.data?.message || error?.message || "Failed to send message";
      toast.error(errMsg);
      loadCaptcha();
    } finally {
      setLoading(false);
    }

  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    let value = e.target.value;
    const name = e.target.name;

    if (name === 'email') {
      value = value.toLowerCase();
    }

    if (name === 'name') {
      const allowedRegex = /^[a-zA-Z\s'-]*$/;
      if (!allowedRegex.test(value)) {
        value = value.slice(0, -1);
      }
      if (value.length > MAX_NAME_LENGTH) {
        value = value.slice(0, MAX_NAME_LENGTH);
      }
    }

    if (name === 'subject') {
      if (!isValidSubject(value)) {
        value = value.slice(0, -1);
      }
      if (value.length > MAX_SUBJECT_LENGTH) {
        value = value.slice(0, MAX_SUBJECT_LENGTH);
      }
    }

    if (name === 'message') {
      if (!isValidMessage(value)) {
        value = value.slice(0, -1);
      }
      if (value.length > MAX_MESSAGE_LENGTH) {
        value = value.slice(0, MAX_MESSAGE_LENGTH);
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header with Background Image */}
      <section className="relative h-[400px] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={hero.image}
            alt="Contact Support" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
        </div>
        
        <div className="container mx-auto px-4 text-center relative z-10 text-white">
          <motion.h1 
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400"
          >
            {hero.title}
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-xl md:text-2xl opacity-90 max-w-2xl mx-auto leading-relaxed"
          >
            {hero.subtitle}
          </motion.p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-16 -mt-20 relative z-20">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Contact Info Cards */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="lg:col-span-1 space-y-6"
          >
            {[
              {
                icon: MapPin,
                title: "Our Location",
                details: [contactDetails.address],
                color: "text-blue-500",
                bg: "bg-blue-500/10",
                border: "border-blue-200 dark:border-blue-900",
                href: undefined
              },
              {
                icon: Phone,
                title: "Call Us",
                details: [contactDetails.mobileNumber],
                color: "text-green-500",
                bg: "bg-green-500/10",
                border: "border-green-200 dark:border-green-900",
                href: `tel:${contactDetails.mobileNumber.replace(/\s+/g, '')}`
              },
              {
                icon: Mail,
                title: "Email Us",
                details: [contactDetails.email],
                color: "text-purple-500",
                bg: "bg-purple-500/10",
                border: "border-purple-200 dark:border-purple-900",
                href: `mailto:${contactDetails.email}`
              },
              {
                icon: Clock,
                title: "Working Hours",
                details: ["Mon - Fri: 8:00 AM - 8:00 PM", "Sat - Sun: 9:00 AM - 5:00 PM"],
                color: "text-orange-500",
                bg: "bg-orange-500/10",
                border: "border-orange-200 dark:border-orange-900",
                href: undefined
              }
            ].map((item, index) => {
              const content = (
                <>
                  <div className={`p-4 rounded-xl ${item.bg} ${item.color}`}>
                    <item.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                    {item.details.map((line, i) => (
                      <p key={i} className="text-muted-foreground text-sm font-medium">{line}</p>
                    ))}
                  </div>
                </>
              );
              const className = `bg-card p-6 rounded-xl shadow-lg border ${item.border} flex items-start gap-4 transition-all duration-300 hover:shadow-xl`;
              return item.href ? (
                <motion.a
                  key={index}
                  href={item.href}
                  whileHover={{ scale: 1.02, x: 5 }}
                  className={`${className} cursor-pointer`}
                >
                  {content}
                </motion.a>
              ) : (
                <motion.div
                  key={index}
                  whileHover={{ scale: 1.02, x: 5 }}
                  className={className}
                >
                  {content}
                </motion.div>
              );
            })}
          </motion.div>

          {/* Contact Form */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="lg:col-span-2"
          >
            <div className="bg-card rounded-2xl shadow-xl border border-border/50 p-8 md:p-10 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-primary/10 rounded-xl">
                  <MessageSquare className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Send us a Message</h2>
                  <p className="text-muted-foreground">We typically reply within 2 hours</p>
                </div>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/80">Full Name (max {MAX_NAME_LENGTH} characters)</label>
                    <input
                      type="text"
                      name="name"
                      required
                      maxLength={MAX_NAME_LENGTH}
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-xl border border-input bg-background/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/80">Email Address</label>
                    <input
                      type="email"
                      name="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-xl border border-input bg-background/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                      placeholder="john@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Subject (max {MAX_SUBJECT_LENGTH} characters)</label>
                  <input
                    type="text"
                    name="subject"
                    required
                    maxLength={MAX_SUBJECT_LENGTH}
                    value={formData.subject}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-xl border border-input bg-background/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                    placeholder="How can we help you?"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Message (max {MAX_MESSAGE_LENGTH} characters)</label>
                  <textarea
                    name="message"
                    required
                    rows={6}
                    maxLength={MAX_MESSAGE_LENGTH}
                    value={formData.message}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-xl border border-input bg-background/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300 resize-none"
                    placeholder="Tell us more about your inquiry..."
                  ></textarea>
                </div>

                {captchaData && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground/80">Security Verification</label>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div 
                          dangerouslySetInnerHTML={{ __html: captchaData.svg }} 
                          className="flex-shrink-0"
                        />
                        <button
                          type="button"
                          onClick={loadCaptcha}
                          disabled={captchaLoading}
                          className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground disabled:opacity-50"
                          title="Refresh CAPTCHA"
                        >
                          <RefreshCw className={`w-5 h-5 ${captchaLoading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={captchaInput}
                        onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                        placeholder="Enter code"
                        className="w-full sm:w-40 px-4 py-3 rounded-xl border border-input bg-background/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-300"
                        maxLength={6}
                      />
                    </div>
                  </div>
                )}

                <motion.button
                  whileHover={{ scale: 1.02 }}

                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  className="w-full md:w-auto px-10 py-4 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/25 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    "Sending..."
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Send Message
                    </>
                  )}
                </motion.button>
              </form>
            </div>
          </motion.div>
        </div>
      </div>

      {/* WhatsApp Floating Button */}
      <motion.a
        href={`https://wa.me/${whatsappNumber || "919849964945"}`}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 bg-green-500 text-white p-4 rounded-full shadow-lg hover:bg-green-600 transition-all duration-300 flex items-center justify-center z-50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current" aria-hidden="true">
          <path d="M20.52 3.48A11.86 11.86 0 0 0 12.03 0C5.41 0 .03 5.38.03 12c0 2.12.56 4.2 1.62 6.03L0 24l6.19-1.62A11.94 11.94 0 0 0 12.03 24c6.62 0 12-5.38 12-12 0-3.2-1.25-6.2-3.51-8.52ZM12.03 21.8c-1.85 0-3.67-.5-5.27-1.45l-.38-.23-3.67.96.98-3.58-.25-.37A9.75 9.75 0 0 1 2.23 12c0-5.4 4.4-9.8 9.8-9.8 2.62 0 5.08 1.02 6.92 2.87a9.7 9.7 0 0 1 2.85 6.93c0 5.4-4.39 9.8-9.77 9.8Zm5.37-7.34c-.29-.14-1.72-.85-1.99-.95-.27-.1-.47-.14-.67.15-.19.28-.76.95-.93 1.14-.17.19-.34.21-.63.07-.29-.14-1.22-.45-2.32-1.43-.86-.77-1.44-1.71-1.61-2-.17-.28-.02-.44.12-.58.13-.13.29-.34.43-.5.15-.17.19-.29.29-.48.1-.2.05-.37-.02-.52-.07-.14-.67-1.63-.92-2.24-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37s-1.04 1.01-1.04 2.46 1.06 2.85 1.21 3.05c.14.19 2.08 3.17 5.03 4.45.7.3 1.26.48 1.69.61.71.23 1.35.2 1.86.12.57-.08 1.72-.7 1.96-1.37.24-.67.24-1.25.17-1.37-.08-.12-.27-.19-.56-.34Z" />
        </svg>
      </motion.a>
    </div>
  );
};

export default Contact;
